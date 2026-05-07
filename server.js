import "dotenv/config";
import cors from "cors";
import express from "express";
import admin from "firebase-admin";
import Stripe from "stripe";
import { Resend } from "resend";

const required = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "RESEND_API_KEY"];
for (const key of required) {
  if (!process.env[key]) {
    console.warn(`Missing ${key}`);
  }
}

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_missing");
const resend = new Resend(process.env.RESEND_API_KEY || "re_missing");

app.use(cors({ origin: process.env.WEB_ORIGIN || "http://127.0.0.1:8080" }));
app.use(express.json());

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

async function verifyUser(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Missing Firebase token" });

  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid Firebase token" });
  }
}

app.post("/create-payment-intent", verifyUser, async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isInteger(amount) || amount < 50) {
    return res.status(400).json({ error: "Invalid amount" });
  }

  const intent = await stripe.paymentIntents.create({
    amount,
    currency: "eur",
    description: "Commande Lilou",
    statement_descriptor_suffix: "LILOU",
    automatic_payment_methods: { enabled: true },
    metadata: {
      userId: req.user.uid,
      source: "lilou-web",
    },
  });

  res.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    paymentIntentClientSecret: intent.client_secret,
    paymentIntentId: intent.id,
  });
});

app.post("/confirm-order", verifyUser, async (req, res) => {
  const { paymentIntentId, items, amount, measurements } = req.body;
  if (!paymentIntentId || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "Invalid order payload" });
  }

  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (intent.status !== "succeeded") {
    return res.status(402).json({ error: "Payment not completed" });
  }

  const orderRef = db.collection("orders").doc();
  const userRecord = await admin.auth().getUser(req.user.uid);
  const email = userRecord.email || req.user.email || "";

  const order = {
    orderId: orderRef.id,
    userId: req.user.uid,
    email,
    amount,
    currency: "eur",
    items,
    measurements: measurements || {},
    paymentIntentId,
    source: "web",
    status: "paid",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await orderRef.set(order);

  const itemLines = items
    .map((item) => `<li>${item.quantity} x ${item.name} - ${item.price} EUR</li>`)
    .join("");

  await resend.emails.send({
    from: process.env.RESEND_FROM || "Lilou <contact@lilousilk.com>",
    to: [email],
    subject: `Confirmation commande Lilou ${orderRef.id}`,
    html: `
      <h1>Commande confirmee</h1>
      <p>Merci pour votre commande Lilou.</p>
      <ul>${itemLines}</ul>
      <p>Total: ${(amount / 100).toFixed(2)} EUR, livraison incluse.</p>
    `,
  });

  res.json({ ok: true, orderId: orderRef.id });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`Lilou backend listening on ${port}`);
});
