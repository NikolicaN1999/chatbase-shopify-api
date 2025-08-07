const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Funkcija za normalizaciju (uklanja č, ć, š, ž, đ itd.)
function normalize(text) {
  return text
    .normalize("NFD") // razdvoji osnovna slova od dijakritika
    .replace(/[\u0300-\u036f]/g, "") // ukloni dijakritike
    .toLowerCase();
}

app.use(express.json());

app.post("/order-status", async (req, res) => {
  const { email, first_name, last_name } = req.body;

  const SHOPIFY_STORE = "printstick.myshopify.com";
  const SHOPIFY_TOKEN = "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";

  // Validacija unosa
  if (!email && (!first_name || !last_name)) {
    return res.status(200).json({
      message:
        "Molimo Vas unesite Vaše ime i prezime ili email adresu koju ste koristili tokom porudžbine kako bismo mogli da proverimo status Vaše porudžbine.",
    });
  }

  if (!email && !first_name && !last_name) {
    return res.status(200).json({
      message: "Molimo unesite barem email ili kombinaciju imena i prezimena.",
    });
  }

  try {
    const response = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2024-04/orders.json?status=any&limit=250`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json",
        },
      }
    );

    const orders = response.data.orders;

    const matchingOrders = orders.filter((order) => {
      const emailMatch = email ? order.email === email : true;
      const firstNameMatch = first_name
        ? normalize(order.customer?.first_name || "") === normalize(first_name)
        : true;
      const lastNameMatch = last_name
        ? normalize(order.customer?.last_name || "") === normalize(last_name)
        : true;
      return emailMatch && firstNameMatch && lastNameMatch;
    });

    if (matchingOrders.length === 0) {
      return res.status(200).json({
        message:
          "Nažalost, nismo pronašli porudžbinu za unete podatke. Proverite informacije i pokušajte ponovo.",
      });
    }

    const lastOrder = matchingOrders[0];
    const status = lastOrder.fulfillment_status;

    if (status === "fulfilled") {
      const sentAt = lastOrder.fulfillments?.[0]?.created_at;
      const trackingNumber = lastOrder.fulfillments?.[0]?.tracking_number;
      const formattedDate = sentAt
        ? new Date(sentAt).toLocaleDateString("sr-RS")
        : "nepoznat datum";

      const trackingUrl =
        "https://www.posta.rs/cir/alati/pracenje-posiljke.aspx";

      return res.status(200).json({
        message: `Vaša porudžbina je poslata ${formattedDate} 📦 Možete je očekivati uskoro na Vašoj adresi.`,
      });
    } else {
      return res.status(200).json({
        message: "Porudžbina još nije poslata.",
      });
    }
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({
      message:
        "Došlo je do greške pri obradi vašeg zahteva. Molimo pokušajte kasnije ili nas kontaktirajte.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server radi na portu ${PORT}`);
});
