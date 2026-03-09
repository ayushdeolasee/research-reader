const year = document.getElementById("year");
if (year) {
  year.textContent = String(new Date().getFullYear());
}

const revealTargets = document.querySelectorAll("[data-reveal]");

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue;
      }

      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  },
  {
    threshold: 0.12,
    rootMargin: "0px 0px -36px 0px",
  }
);

for (const target of revealTargets) {
  observer.observe(target);
}
