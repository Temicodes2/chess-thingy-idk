const checkoutButton = document.querySelector("#subscribe-button");
const portalButton = document.querySelector("#manage-subscription-button");
const checkoutStatus = document.querySelector("#subscription-status");
const storageKey = "chess-studio-checkout-session";

function showStatus(message) {
  checkoutStatus.textContent = message;
}

async function verifySubscription(sessionId) {
  const response = await fetch(`/api/subscription-status?session_id=${encodeURIComponent(sessionId)}`, {
    headers: { Accept: "application/json" },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Could not verify subscription.");
  return result.active === true;
}

async function refreshSubscription() {
  const query = new URLSearchParams(window.location.search);
  const returnedSessionId = query.get("session_id");
  if (returnedSessionId && query.get("checkout") === "success") {
    localStorage.setItem(storageKey, returnedSessionId);
    query.delete("session_id");
    query.delete("checkout");
    const nextQuery = query.toString();
    history.replaceState(null, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
    showStatus("Payment received. Checking your subscription…");
  } else if (query.get("checkout") === "cancel") {
    query.delete("checkout");
    const nextQuery = query.toString();
    history.replaceState(null, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
    showStatus("Checkout canceled. No subscription was started.");
  }

  const sessionId = localStorage.getItem(storageKey);
  if (!sessionId) return;
  try {
    const active = await verifySubscription(sessionId);
    if (active) {
      showStatus("Your subscription is active. Thank you for supporting Chess Studio!");
      portalButton.hidden = false;
      document.dispatchEvent(new CustomEvent("chess-studio-subscription", { detail: { active: true } }));
    } else {
      localStorage.removeItem(storageKey);
      portalButton.hidden = true;
      if (!checkoutStatus.textContent) showStatus("No active subscription was found for this browser.");
      document.dispatchEvent(new CustomEvent("chess-studio-subscription", { detail: { active: false } }));
    }
  } catch (error) {
    showStatus(`${error.message} Your saved subscription will be checked again when you reload.`);
  }
}

checkoutButton.addEventListener("click", async () => {
  checkoutButton.disabled = true;
  showStatus("Opening secure Stripe Checkout…");
  try {
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.url !== "string") {
      throw new Error(result.error || "Could not start checkout.");
    }
    window.location.assign(result.url);
  } catch (error) {
    showStatus(error.message.includes("Failed to fetch")
      ? "Stripe subscriptions need the Node web service deployment; they are not available on a static-site deployment or the Vite dev server."
      : error.message);
    checkoutButton.disabled = false;
  }
});

portalButton.addEventListener("click", async () => {
  const sessionId = localStorage.getItem(storageKey);
  if (!sessionId) {
    showStatus("No saved Checkout session was found in this browser. Contact support if you need help managing billing.");
    portalButton.hidden = true;
    return;
  }
  portalButton.disabled = true;
  showStatus("Opening subscription management…");
  try {
    const response = await fetch("/api/create-portal-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.url !== "string") {
      throw new Error(result.error || "Could not open subscription management.");
    }
    window.location.assign(result.url);
  } catch (error) {
    showStatus(error.message);
    portalButton.disabled = false;
  }
});

void refreshSubscription();
