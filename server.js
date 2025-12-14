import express from "express";
import Stripe from "stripe";

const app = express();
app.use(express.json());

// Stripe utilise la clé secrète (elle viendra de Render plus tard)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Route test (pour vérifier que le serveur répond)
app.get("/", (req, res) => {
  res.send("Selecto Stripe backend OK");
});

// Route appelée par l'app iOS
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency } = req.body;

    if (!amount || typeof amount !== "number") {
      return res.status(400).send("Invalid amount");
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: currency || "eur",
      automatic_payment_methods: { enabled: true }
    });

    res.json({
      paymentIntentClientSecret: paymentIntent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Port utilisé par Render
const PORT = process.env.PORT || 4242;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});//
//  server.js
//  selecto-stripe-backend
//
//  Created by Angèle Daheb on 14/12/2025.
//

