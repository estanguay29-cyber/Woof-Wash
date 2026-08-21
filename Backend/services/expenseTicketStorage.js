"use strict";

const crypto = require("crypto");
const https = require("https");

const TICKET_FOLDER = String(process.env.CLOUDINARY_EXPENSE_TICKET_FOLDER || "woofwash/admin/expense-tickets").trim();
const REQUEST_TIMEOUT_MS = 15000;
const DOWNLOAD_TTL_SECONDS = 300;

function getConfig() {
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || "").trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || "").trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || "").trim();
  if (!cloudName || !apiKey || !apiSecret) throw new Error("TICKET_STORAGE_UNAVAILABLE");
  return { cloudName, apiKey, apiSecret };
}

function sign(params, secret) {
  const payload = Object.keys(params).filter((key) => params[key] !== "" && params[key] != null)
    .sort().map((key) => `${key}=${params[key]}`).join("&");
  return crypto.createHash("sha1").update(`${payload}${secret}`).digest("hex");
}

function field(boundary, name, value) {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
}

function filePart(boundary, bytes, mimeType) {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ticket"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    bytes,
    Buffer.from("\r\n")
  ]);
}

function requestJson(options, body) {
  return new Promise((resolve, reject) => {
    const request = https.request({ ...options, timeout: REQUEST_TIMEOUT_MS }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        let data = {};
        try { data = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { data = {}; }
        if ((response.statusCode || 500) < 200 || response.statusCode >= 300) return reject(new Error("TICKET_STORAGE_FAILED"));
        resolve(data);
      });
    });
    request.on("timeout", () => request.destroy(new Error("TICKET_STORAGE_TIMEOUT")));
    request.on("error", () => reject(new Error("TICKET_STORAGE_FAILED")));
    request.end(body);
  });
}

function createCloudinaryExpenseTicketStorage() {
  return {
    async upload({ bytes, mimeType, format, resourceType }) {
      const config = getConfig();
      const timestamp = Math.floor(Date.now() / 1000);
      const randomId = crypto.randomUUID().replace(/-/g, "");
      const publicId = `${TICKET_FOLDER}/${randomId}${resourceType === "raw" ? ".pdf" : ""}`;
      const signed = { public_id: publicId, timestamp, type: "authenticated" };
      const boundary = `----woofwash-ticket-${crypto.randomBytes(12).toString("hex")}`;
      const body = Buffer.concat([
        field(boundary, "api_key", config.apiKey), field(boundary, "timestamp", timestamp),
        field(boundary, "public_id", publicId), field(boundary, "type", "authenticated"),
        field(boundary, "signature", sign(signed, config.apiSecret)), filePart(boundary, bytes, mimeType),
        Buffer.from(`--${boundary}--\r\n`)
      ]);
      const data = await requestJson({
        method: "POST", hostname: "api.cloudinary.com",
        path: `/v1_1/${encodeURIComponent(config.cloudName)}/${resourceType}/upload`,
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length }
      }, body);
      if (!data.public_id || data.type !== "authenticated") throw new Error("TICKET_STORAGE_FAILED");
      return { publicId: data.public_id, resourceType, format };
    },

    async remove({ publicId, resourceType }) {
      const config = getConfig();
      const timestamp = Math.floor(Date.now() / 1000);
      const signed = { public_id: publicId, timestamp, type: "authenticated" };
      const body = new URLSearchParams({
        api_key: config.apiKey, public_id: publicId, timestamp: String(timestamp),
        type: "authenticated", signature: sign(signed, config.apiSecret)
      }).toString();
      await requestJson({
        method: "POST", hostname: "api.cloudinary.com",
        path: `/v1_1/${encodeURIComponent(config.cloudName)}/${resourceType}/destroy`,
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) }
      }, body);
    },

    createTemporaryAccess({ publicId, resourceType, format }) {
      const config = getConfig();
      const timestamp = Math.floor(Date.now() / 1000);
      const expiresAt = timestamp + DOWNLOAD_TTL_SECONDS;
      const signed = { attachment: false, expires_at: expiresAt, format, public_id: publicId, timestamp, type: "authenticated" };
      const query = new URLSearchParams({
        api_key: config.apiKey, attachment: "false", expires_at: String(expiresAt), format,
        public_id: publicId, timestamp: String(timestamp), type: "authenticated",
        signature: sign(signed, config.apiSecret)
      });
      return { url: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${resourceType}/download?${query}`, expiresAt };
    }
  };
}

module.exports = { DOWNLOAD_TTL_SECONDS, TICKET_FOLDER, createCloudinaryExpenseTicketStorage };
