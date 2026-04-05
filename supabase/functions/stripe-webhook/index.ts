import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
})

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!

serve(async (req) => {
  const signature = req.headers.get("stripe-signature")
  if (!signature) {
    return new Response("Missing signature", { status: 400 })
  }

  const body = await req.text()

  let event
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET)
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message)
    return new Response("Webhook Error: " + err.message, { status: 400 })
  }

  console.log("Received event: " + event.type)

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object
        const email = session.customer_email || session.customer_details?.email
        const customerId = session.customer

        if (!email) {
          console.error("No email found in checkout session")
          break
        }

        let proExpiresAt = null
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription)
          proExpiresAt = new Date(sub.current_period_end * 1000).toISOString()
        }

        const { error } = await supabase
          .from("profiles")
          .update({
            plan: "pro",
            stripe_customer_id: customerId,
            pro_expires_at: proExpiresAt,
          })
          .eq("email", email.toLowerCase())

        if (error) console.error("Update error (checkout):", error.message)
        else console.log("upgraded to pro: " + email)
        break
      }

      case "invoice.paid": {
        const invoice = event.data.object
        const customerId = invoice.customer

        let proExpiresAt = null
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription)
          proExpiresAt = new Date(sub.current_period_end * 1000).toISOString()
        }

        const { error } = await supabase
          .from("profiles")
          .update({
            plan: "pro",
            pro_expires_at: proExpiresAt,
          })
          .eq("stripe_customer_id", customerId)

        if (error) console.error("Update error (invoice):", error.message)
        else console.log("renewed: " + customerId)
        break
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object
        const customerId = subscription.customer

        const { error } = await supabase
          .from("profiles")
          .update({
            plan: "free",
            pro_expires_at: null,
          })
          .eq("stripe_customer_id", customerId)

        if (error) console.error("Update error (deleted):", error.message)
        else console.log("downgraded: " + customerId)
        break
      }

      default:
        console.log("Unhandled event type: " + event.type)
    }
  } catch (err) {
    console.error("Error processing webhook:", err.message)
    return new Response("Internal error", { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  })
})
