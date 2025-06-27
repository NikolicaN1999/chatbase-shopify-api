const axios = require("axios");

module.exports = async (req, res) => {
  const { email, first_name, last_name } = req.body;

  const SHOPIFY_STORE = "printstick.myshopify.com";
  const SHOPIFY_TOKEN = "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";

  // Validacija unosa
  if (!email && (!first_name || !last_name)) {
    return res.status(200).json({
      message: "Molimo Vas unesite Vaše ime i prezime ili email adresu koju ste koristili tokom porudžbine kako bismo mogli da proverimo status Vaše porudžbine."
    });
  }

  if (!email && !first_name && !last_name) {
    return res.status(200).json({
      message: "Molimo unesite barem email ili kombinaciju imena i prezimena."
    });
  }

  try {
    // Poziv ka Shopify API-ju uz status=any i limit=250
    const response = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2024-04/orders.json?status=any&limit=250`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    const orders = response.data.orders;

    // Filtriranje porudžbina prema unetim podacima
    const matchingOrders = orders.filter(order => {
      const emailMatch = email ? order.email === email : true;
      const firstNameMatch = first_name ? order.customer?.first_name?.toLowerCase() === first_name.toLowerCase() : true;
      const lastNameMatch = last_name ? order.customer?.last_name?.toLowerCase() === last_name.toLowerCase() : true;
      return emailMatch && firstNameMatch && lastNameMatch;
    });

    if (matchingOrders.length === 0) {
      return res.status(200).json({
        message: "Nažalost, nismo pronašli porudžbinu za unete podatke. Proverite informacije i pokušajte ponovo."
      });
    }

    const lastOrder = matchingOrders[0];
    const status = lastOrder.fulfillment_status;

    if (status === "fulfilled") {
      const sentAt = lastOrder.fulfillments?.[0]?.created_at;
      const formattedDate = sentAt
        ? new Date(sentAt).toLocaleString("sr-RS")
        : "nepoznat datum";

      const trackingNumber = lastOrder.fulfillments?.[0]?.tracking_number || "nije unet";
      const trackingUrl = lastOrder.fulfillments?.[0]?.tracking_url || "";

      return res.status(200).json({
        message: `📦 Porudžbina je poslata ${formattedDate}.\nBroj za praćenje: ${trackingNumber}${trackingUrl ? `\nPratite je ovde: ${trackingUrl}` : ""}`
      });
    } else {
      return res.status(200).json({
        message: "Porudžbina još nije poslata."
      });
    }
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({
      message: "Došlo je do greške pri obradi vašeg zahteva. Molimo pokušajte kasnije ili nas kontaktirajte."
    });
  }
};
