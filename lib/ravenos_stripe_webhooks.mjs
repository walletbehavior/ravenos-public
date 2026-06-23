import {
  markSubscriptionPaymentFailed,
  markWebhookProcessed,
  recordWebhookEvent,
  subscriptionRowFromStripeSubscription,
  upsertSubscriptionStatus,
} from "./ravenos_subscriptions.mjs";

export const SUPPORTED_STRIPE_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
]);

export async function processStripeWebhookEvent({ env = {}, event, stripe = null } = {}) {
  if (!event?.id || !event?.type) throw new Error("invalid_stripe_event");
  const shouldProcess = await recordWebhookEvent(env, event);
  if (!shouldProcess) return { ok: true, duplicate: true };
  if (!SUPPORTED_STRIPE_EVENTS.has(event.type)) {
    await markWebhookProcessed(env, event.id);
    return { ok: true, ignored: true };
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.subscription && stripe?.subscriptions?.retrieve) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription, {
        expand: ["items.data.price"],
      });
      await upsertSubscriptionStatus(
        env,
        subscriptionRowFromStripeSubscription(subscription, {
          walletFallback: session.client_reference_id || session.metadata?.wallet_public_key || "",
          env,
        }),
      );
    }
  }

  if (
    event.type === "customer.subscription.created"
    || event.type === "customer.subscription.updated"
    || event.type === "customer.subscription.deleted"
  ) {
    await upsertSubscriptionStatus(
      env,
      subscriptionRowFromStripeSubscription(event.data.object, { env }),
    );
  }

  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object;
    await markSubscriptionPaymentFailed(env, {
      subscriptionId: String(invoice.subscription || ""),
      customerId: String(invoice.customer || ""),
    });
  }

  await markWebhookProcessed(env, event.id);
  return { ok: true, duplicate: false };
}
