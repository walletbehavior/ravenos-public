const LEGAL_ACCEPTANCE_ROUTE = "/api/v1/legal/acceptances";

const CAPABILITIES = Object.freeze({
  pro_subscription: Object.freeze({
    document_types: Object.freeze(["terms", "privacy"]), eyebrow: "Raven Pro and Rewards", title: "Review Pro and rewards terms",
    summary: "The free trial requires no card and ends without a charge. Paid Pro is $149/month by your explicit choice. Rewards are a rebate of confirmed Raven execution fees; invoice credits and claims are separate actions.",
    acknowledgement: "I agree to the Terms of Service, including Raven Rewards, and acknowledge the Privacy Policy.",
  }),
  trading_activation: Object.freeze({
    document_types: Object.freeze(["terms", "privacy", "trading_risk"]),
    eyebrow: "Before your first trade",
    title: "Review trading risks",
    summary: "Digital-asset trades can lose all value. Quotes expire, displayed prices may not be executable, and network, smart-contract, liquidity, slippage, bridge, wallet, and provider failures can cause losses.",
    acknowledgement: "I agree to the Terms of Service and acknowledge the Privacy Policy and Digital Asset & Trading Risk Disclosure.",
  }),
  embedded_wallet_activation: Object.freeze({
    document_types: Object.freeze(["terms", "privacy", "trading_risk"]),
    eyebrow: "Optional Raven Wallet",
    title: "Review wallet terms and risks",
    summary: "An embedded wallet uses third-party wallet infrastructure. Protect your Raven account, review every transaction, and understand the available recovery, export, and withdrawal paths before funding it.",
    acknowledgement: "I agree to the Terms of Service and acknowledge the Privacy Policy and Digital Asset & Trading Risk Disclosure for this wallet setup.",
  }),
  copy_activation: Object.freeze({
    document_types: Object.freeze(["terms", "privacy", "trading_risk", "copy_trading"]),
    eyebrow: "Before live Raven Copy",
    title: "Review follower execution risk",
    summary: "Copying cannot reproduce a source wallet's timing, price, size, execution, or results. Raven may skip trades, and a source can profit while a follower loses.",
    acknowledgement: "I agree to the Terms of Service and acknowledge the Privacy, Trading Risk, and Copy Trading disclosures.",
  }),
  community_publication: Object.freeze({
    document_types: Object.freeze(["terms", "privacy", "community_guidelines"]),
    eyebrow: "Before publishing",
    title: "Review your public profile choices",
    summary: "Only the settings you enable should become public, but public information may be copied or retained by others. Wallet ownership is never inferred as your Raven identity without a separate opt-in proof.",
    acknowledgement: "I agree to the Terms of Service and Community Guidelines and acknowledge the Privacy Policy for these public settings.",
  }),
  affiliate_enrollment: Object.freeze({
    document_types: Object.freeze(["terms", "privacy", "affiliate_terms"]),
    eyebrow: "Affiliate enrollment",
    title: "Review referral program terms",
    summary: "Referral attribution is not an investment endorsement or an earnings promise. Compensation, if offered, depends on the then-current program and clear disclosure of the relationship.",
    acknowledgement: "I agree to the Terms of Service and Affiliate & Referral Program Terms and acknowledge the Privacy Policy.",
  }),
});

let activePrompt = null;

function exactCapability(payload, requestedCapability) {
  if (payload?.error !== "legal_acceptance_required") return null;
  const capability = String(payload?.capability?.capability || "");
  const config = CAPABILITIES[capability];
  if (!config || (requestedCapability && requestedCapability !== capability)) return null;
  const rows = Array.isArray(payload.capability.required_documents) ? payload.capability.required_documents : [];
  const documents = rows.map((row) => row?.document).filter(Boolean);
  const expected = new Set(config.document_types);
  if (documents.length !== expected.size || new Set(documents.map((document) => document.document_type)).size !== documents.length) return null;
  if (!documents.every((document) => (
    expected.has(document.document_type)
    && document.status === "effective"
    && typeof document.title === "string"
    && document.title.trim().length >= 3
    && document.title.trim().length <= 120
    && /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z0-9-]{3,64}$/.test(String(document.version || ""))
    && /^\/(?!\/)(?!.*\/\/)[a-z0-9][a-z0-9/_-]*\/$/.test(String(document.canonical_path || ""))
    && /^[0-9a-f]{64}$/.test(String(document.content_hash || ""))
  ))) return null;
  return { capability, config, documents };
}

function closeDialog(dialog) {
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

async function recordAcceptance({ capability, documents, csrfToken, fetchImpl }) {
  if (!/^csrf_[A-Za-z0-9_-]{20,180}$/.test(String(csrfToken || ""))) throw new Error("sign_in_again");
  const response = await fetchImpl(LEGAL_ACCEPTANCE_ROUTE, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-ravenos-csrf": csrfToken,
    },
    body: JSON.stringify({
      capability,
      acceptances: documents.map((document) => ({
        document_type: document.document_type,
        version: document.version,
        content_hash: document.content_hash,
        acknowledgement: document.document_type === "privacy" ? "acknowledged" : "agreed",
      })),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.capability?.satisfied !== true) throw new Error(payload?.error || "legal_acceptance_unavailable");
}

export function requestLegalAcceptance(payload, {
  capability: requestedCapability = "",
  csrfToken = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const exact = exactCapability(payload, requestedCapability);
  if (!exact || typeof fetchImpl !== "function") return Promise.resolve(false);
  if (activePrompt) return activePrompt;
  activePrompt = new Promise((resolve) => {
    const dialog = document.getElementById("ravenosLegalAcceptanceDialog") || document.createElement("dialog");
    dialog.id = "ravenosLegalAcceptanceDialog";
    dialog.className = "ravenos-legal-dialog";
    dialog.setAttribute("aria-labelledby", "ravenosLegalAcceptanceTitle");
    if (!dialog.isConnected) document.body.append(dialog);
    dialog.replaceChildren();

    const header = document.createElement("header");
    const heading = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.textContent = exact.config.eyebrow;
    const title = document.createElement("h2");
    title.id = "ravenosLegalAcceptanceTitle";
    title.textContent = exact.config.title;
    heading.append(eyebrow, title);
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Cancel";
    header.append(heading, close);

    const intro = document.createElement("p");
    intro.textContent = exact.config.summary;
    const links = document.createElement("div");
    links.className = "ravenos-legal-links";
    for (const legalDocument of exact.documents) {
      const link = document.createElement("a");
      link.href = legalDocument.canonical_path;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = legalDocument.title;
      links.append(link);
    }
    const assent = document.createElement("label");
    assent.className = "ravenos-legal-assent";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = false;
    const assentText = document.createElement("span");
    assentText.textContent = exact.config.acknowledgement;
    assent.append(checkbox, assentText);
    const error = document.createElement("p");
    error.className = "ravenos-legal-error";
    error.hidden = true;
    const actions = document.createElement("footer");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Not now";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "ravenos-legal-accept";
    accept.textContent = "Accept and continue";
    accept.disabled = true;
    actions.append(cancel, accept);
    dialog.append(header, intro, links, assent, error, actions);

    let settled = false;
    const finish = (accepted) => {
      if (settled) return;
      settled = true;
      activePrompt = null;
      resolve(accepted);
    };
    const dismiss = () => {
      closeDialog(dialog);
      finish(false);
    };
    close.addEventListener("click", dismiss);
    cancel.addEventListener("click", dismiss);
    checkbox.addEventListener("change", () => { accept.disabled = !checkbox.checked; });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      dismiss();
    }, { once: true });
    dialog.addEventListener("close", () => finish(false), { once: true });
    accept.addEventListener("click", async () => {
      if (!checkbox.checked || accept.disabled) return;
      accept.disabled = true;
      cancel.disabled = true;
      close.disabled = true;
      error.hidden = true;
      accept.textContent = "Recording…";
      try {
        await recordAcceptance({ ...exact, csrfToken, fetchImpl });
        finish(true);
        closeDialog(dialog);
      } catch (acceptanceError) {
        accept.textContent = "Try again";
        accept.disabled = false;
        cancel.disabled = false;
        close.disabled = false;
        error.textContent = String(acceptanceError?.message || "legal_acceptance_unavailable").replaceAll("_", " ");
        error.hidden = false;
      }
    });
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });
  return activePrompt;
}

export const RavenOSLegalClientContract = Object.freeze({
  legal_acceptance_route: LEGAL_ACCEPTANCE_ROUTE,
  capabilities: Object.freeze(Object.keys(CAPABILITIES)),
  checkbox_preselected: false,
  exact_effective_documents_required: true,
  client_supplied_user_id: false,
});
