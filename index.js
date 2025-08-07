const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/**
 * Pretvara ćirilicu u latinicu
 */
function cyrToLat(text) {
  const map = {
    А: "A", а: "a", Б: "B", б: "b", В: "V", в: "v",
    Г: "G", г: "g", Д: "D", д: "d", Ђ: "Đ", ђ: "đ",
    Е: "E", е: "e", Ж: "Ž", ж: "ž", З: "Z", з: "z",
    И: "I", и: "i", Ј: "J", ј: "j", К: "K", к: "k",
    Л: "L", л: "l", Љ: "Lj", љ: "lj", М: "M", м: "m",
    Н: "N", н: "n", Њ: "Nj", њ: "nj", О: "O", о: "o",
    П: "P", п: "p", Р: "R", р: "r", С: "S", с: "s",
    Т: "T", т: "t", Ћ: "Ć", ћ: "ć", У: "U", у: "u",
    Ф: "F", ф: "f", Х: "H", х: "h", Ц: "C", ц: "c",
    Ч: "Č", ч: "č", Џ: "Dž", џ: "dž", Ш: "Š", ш: "š"
  };
  return text
    .split("")
    .map(char => map[char] || char)
    .join("");
}

/**
 * Normalizuje tekst: ćirilicu → latinicu, uklanja dijakritiku, pretvara u lowercase
 */
function normalize(text) {
  return cyrToLat(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

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
          "Nažalost, nismo pronašli porudžbinu za unete podatke. Molimo Vas unesite Vašu email adresu koju ste koristili tokom porudžbine kako bismo mogli da proverimo status Vaše porudžbine.",
      });
    }

    const lastOrder = matchingOrders[0];
    const status = lastOrder.fulfillment_status;

    if (status === "fulfilled") {
      const sentAt = lastOrder.fulfillments?.[0]?.created_at;
      const formattedDate = sentAt
        ? new Date(sentAt).toLocaleDateString("sr-RS")
        : "nepoznat datum";

      return res.status(200).json({
        message: `Vaša porudžbina je poslata ${formattedDate} 📦 Možete je očekivati uskoro na Vašoj adresi.`,
      });
    } else {
      return res.status(200).json({
        message:
          "Vaša porudžbina je primljena i trenutno se obrađuje. Rok za izradu i pripremu porudžbine je obično između 5-7 radnih dana.",
      });
    }
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({
      message:
        "Došlo je do greške pri obradi Vašeg zahteva. Molimo pokušajte kasnije ili nas kontaktirajte na broj telefona 063/497 489.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server radi na portu ${PORT}`);
});
