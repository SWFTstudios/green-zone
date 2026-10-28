/* Review popup shared by the landing page and the app. Reviews go to /api/reviews; the team inbox stays on the server. */

const LABELS = ["", "Not for me", "Needs work", "It's OK", "Really useful", "Love it"];

let dialog = null;

function build() {
  dialog = document.createElement("dialog");
  dialog.className = "rv-dialog";
  dialog.setAttribute("aria-labelledby", "rv-title");
  dialog.innerHTML = `
    <form class="rv-form" novalidate>
      <button type="button" class="rv-close" data-rv-close aria-label="Close">×</button>
      <div class="rv-body">
        <h2 id="rv-title">How's Green Zone working for you?</h2>
        <p class="rv-sub">What worked, what didn't, what you'd add. The team reads every review.</p>
        <fieldset class="rv-stars">
          <legend>Your rating</legend>
          ${[1, 2, 3, 4, 5]
            .map(
              (n) => `<input type="radio" name="rating" id="rv-star-${n}" value="${n}" required>
              <label for="rv-star-${n}" title="${LABELS[n]}"><span class="rv-sr">${n} star${n > 1 ? "s" : ""}, ${LABELS[n]}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/></svg></label>`,
            )
            .join("")}
          <span class="rv-star-label" aria-hidden="true">Tap a star</span>
        </fieldset>
        <label class="rv-label" for="rv-message">Your review</label>
        <textarea id="rv-message" name="message" rows="4" maxlength="2000" required placeholder="I drove three neighborhoods on Saturday and…"></textarea>
        <div class="rv-row">
          <div><label class="rv-label" for="rv-name">Name <span>(optional)</span></label><input id="rv-name" name="name" maxlength="80" autocomplete="name"></div>
          <div><label class="rv-label" for="rv-email">Email <span>(only if you'd like a reply)</span></label><input id="rv-email" name="email" type="email" maxlength="254" autocomplete="email" inputmode="email"></div>
        </div>
        <div class="rv-hp" aria-hidden="true"><label for="rv-website">Website</label><input id="rv-website" name="website" tabindex="-1" autocomplete="off"></div>
        <p class="rv-error" role="alert" hidden></p>
        <button class="rv-submit" type="submit">Send review</button>
        <p class="rv-fine">Your email is only used to reply to you. It's never shown or shared.</p>
      </div>
      <div class="rv-done" hidden>
        <div class="rv-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg></div>
        <h2>Thank you!</h2>
        <p class="rv-sub">Your review is on its way to the Green Zone team.</p>
        <button class="rv-submit" type="button" data-rv-close>Done</button>
      </div>
    </form>`;
  document.body.append(dialog);

  const form = dialog.querySelector("form");
  const starLabel = dialog.querySelector(".rv-star-label");
  const error = dialog.querySelector(".rv-error");
  const paintStars = (value) =>
    dialog.querySelectorAll(".rv-stars label").forEach((label, i) => label.classList.toggle("on", i < value));
  form.addEventListener("change", (e) => {
    if (e.target.name !== "rating") return;
    starLabel.textContent = LABELS[Number(e.target.value)];
    paintStars(Number(e.target.value));
  });
  form.addEventListener("input", () => (error.hidden = true));
  dialog.addEventListener("click", (e) => {
    if (e.target.closest("[data-rv-close]") || e.target === dialog) dialog.close();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fields = Object.fromEntries(new FormData(form));
    const fail = (msg) => {
      error.textContent = msg;
      error.hidden = false;
    };
    error.hidden = true;
    if (!fields.rating) return fail("Pick a rating from 1 to 5 stars.");
    if (String(fields.message || "").trim().length < 2) return fail("Write a few words about your experience.");
    const btn = form.querySelector(".rv-submit");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...fields, rating: Number(fields.rating), source: dialog.dataset.source || "landing" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "We couldn't send your review. Please try again.");
      form.reset();
      paintStars(0);
      starLabel.textContent = "Tap a star";
      dialog.querySelector(".rv-body").hidden = true;
      dialog.querySelector(".rv-done").hidden = false;
      try {
        localStorage.setItem("gz_reviewed", String(Date.now()));
      } catch {
        /* not critical */
      }
    } catch (err) {
      fail(err instanceof TypeError ? "No connection. Check your signal and try again." : err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Send review";
    }
  });
}

/** Opens the review popup. `source` says where it was left from ("landing" or "app"). */
export function openReview({ source = "landing" } = {}) {
  if (!dialog) build();
  dialog.dataset.source = source;
  dialog.querySelector(".rv-body").hidden = false;
  dialog.querySelector(".rv-done").hidden = true;
  dialog.querySelector(".rv-error").hidden = true;
  if (!dialog.open) dialog.showModal();
}

/** Any element with [data-review] opens the popup. */
export function bindReviewButtons({ source = "landing" } = {}) {
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-review]");
    if (!trigger) return;
    e.preventDefault();
    openReview({ source });
  });
}

export function hasReviewed() {
  try {
    return !!localStorage.getItem("gz_reviewed");
  } catch {
    return false;
  }
}
