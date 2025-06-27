const axios = require("axios");

module.exports = async (req, res) => {
  const { email } = req.body;

  const SHOPIFY_STORE = "printstick.myshopify.com"; 
  const SHOPIFY_TOKEN = "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";    

  try {
    const response = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2024-04/orders.json?email=${email}`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    const orders = response.data.orders;
    if (orders.length === 0) {
      return res.status(200).json({ message: "Nema porudžbina za ovaj email." });
    }

    const lastOrder = orders[0];
    const status = lastOrder.fulfillment_status;
    const msg = status === "fulfilled"
      ? "Porudžbina je poslata."
      : "Porudžbina još nije poslata.";

    res.status(200).json({ message: msg });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ message: "Greška pri komunikaciji sa Shopify API-jem." });
  }
};
