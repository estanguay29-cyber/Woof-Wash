"use strict";

const crypto = require("node:crypto");

function requireBuffer(value, length, label) {
  if (!Buffer.isBuffer(value) || value.length !== length) throw new TypeError(`${label} debe ser un Buffer de ${length} bytes`);
  return value;
}

function createGiftCardDeliveryCryptoProvider({ key, keyId, randomBytes = crypto.randomBytes } = {}) {
  requireBuffer(key, 32, "key");
  if (typeof keyId !== "string" || !/^[A-Za-z0-9._-]{3,80}$/.test(keyId)) throw new TypeError("keyId invalido");
  if (typeof randomBytes !== "function") throw new TypeError("randomBytes debe ser una funcion inyectable");

  function encrypt(plaintext, { deliveryId, giftCardId, operationId } = {}) {
    if (typeof plaintext !== "string" || plaintext.length < 16) throw new TypeError("plaintext invalido");
    const aad = `${deliveryId}:${giftCardId}:${operationId}`;
    if (aad.includes("undefined") || aad.includes("null")) throw new TypeError("Contexto criptografico incompleto");
    const iv = requireBuffer(randomBytes(12), 12, "iv");
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Object.freeze({
      algorithm: "aes-256-gcm",
      keyId,
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      aadDigest: crypto.createHash("sha256").update(aad).digest("hex")
    });
  }

  function decrypt(envelope, { deliveryId, giftCardId, operationId } = {}) {
    if (!envelope || envelope.algorithm !== "aes-256-gcm" || envelope.keyId !== keyId) throw new TypeError("Envelope incompatible");
    const aad = `${deliveryId}:${giftCardId}:${operationId}`;
    const digest = crypto.createHash("sha256").update(aad).digest("hex");
    if (digest !== envelope.aadDigest) throw new Error("Contexto criptografico no coincide");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()
    ]).toString("utf8");
  }

  return Object.freeze({ keyId, encrypt, decrypt });
}

module.exports = { createGiftCardDeliveryCryptoProvider };
