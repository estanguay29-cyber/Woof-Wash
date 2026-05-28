document.addEventListener("DOMContentLoaded", () => {
  const currentPage = document.body.dataset.page;
  document.querySelectorAll("[data-admin-nav]").forEach((link) => {
    if (link.dataset.adminNav === currentPage) {
      link.classList.add("is-active");
    }
  });
});
