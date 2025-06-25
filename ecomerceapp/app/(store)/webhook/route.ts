import { Metadata } from "@/actions/createCheckoutSession";
import stripe from "@/lib/stripe";
import { backendClient } from "@/sanity/lib/backendClient";

import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

export async function POST(req:NextRequest) {
    const body = await req.text();
    const headersList = await headers();
    const sig = headersList.get("stripe-signature")

    if (!sig) {
        return NextResponse.json({error: "No signature"}, { status: 400});
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.log(" Stripe webhook secret is not set.")
        return NextResponse.json(
            { error: "Stripe webhook secret is not set"},
            {status: 400}
        )
    }

    let event: Stripe.Event;
    try {
        event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
        console.error("Webhook signature verification failed:", err);
        return NextResponse.json(
            {error: `Webhook Error: ${err}`},
            {status: 400}
        );
    }

    if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    
    console.log("✅ Webhook recebido: checkout.session.completed");
    console.log("📦 Session recebida do Stripe:", session);

    try {
        const order = await createOrderInSanity(session);
        console.log("✅ Pedido criado no Sanity:", order);
    } catch (err) {
        console.error("❌ Erro ao criar pedido no Sanity:", err);
        return NextResponse.json({ error: "Erro ao criar pedido no Sanity" }, { status: 500 });
    }
}

    return NextResponse.json({recived: true});

}

async function createOrderInSanity(session: Stripe.Checkout.Session) {
    const {
        id,
        amount_total,
        currency,
        metadata,
        payment_intent,
        customer,
        total_details,
    } = session;

    console.log("🔍 Dados do metadata:", metadata);

    const { orderNumber, customerName, customerEmail, clerkUserId } =
        metadata as Metadata;

    const lineItemsWithProduct = await stripe.checkout.sessions.listLineItems(id, {
        expand: ["data.price.product"],
    });

    console.log("🧾 Produtos do Stripe:", lineItemsWithProduct.data);

    const sanityProducts = lineItemsWithProduct.data.map((item) => {
        const productId = (item.price?.product as Stripe.Product)?.metadata?.id;
        console.log("📌 ID do produto referenciado:", productId);

        return {
            _key: crypto.randomUUID(),
            product: {
                _type: "reference",
                _ref: productId,
            },
            quantity: item.quantity || 0,
        };
    });

    console.log("📤 Produtos convertidos para Sanity:", sanityProducts);

    const order = await backendClient.create({
        _type: "order",
        orderNumber,
        stripeCheckoutSessionId: id,
        stripePaymentIntentId: payment_intent,
        customerName,
        stripeCustomerId: customer,
        clerkUserId: clerkUserId,
        email: customerEmail,
        currency,
        amountDiscount: total_details?.amount_discount ? total_details.amount_discount / 100 : 0,
        products: sanityProducts,
        totalPrice: amount_total ? amount_total / 100 : 0,
        status: "paid",
        orderDate: new Date().toISOString(),
    });

    return order;
}