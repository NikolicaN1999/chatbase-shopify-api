const axios = require("axios");

module.exports = async (req, res) => {
  const { email, first_name, last_name } = req.body;

  const SHOPIFY_STORE = "printstick.myshopify.com";
  const SHOPIFY_TOKEN = "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";   

  try {
    const response = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2024-04/orders.json`,
      {
        headers: {
          "X-Shopify-Access-Token": SHOPIFY_TOKEN,
          "Content-Type": "application/json"
        }
      }
    );

    const orders = response.data.orders;

    const matchingOrders = orders.filter(order =>
      order.email === email &&
      order.customer?.first_name?.toLowerCase() === first_name.toLowerCase() &&
      order.customer?.last_name?.toLowerCase() === last_name.toLowerCase()
    );

    if (matchingOrders.length === 0) {
      return res.status(200).json({
        message: "Nažalost, nismo pronašli porudžbinu za unete podatke. Proverite informacije i pokušajte ponovo."
      });
    }

    const lastOrder = matchingOrders[0];
    const status = lastOrder.fulfillment_status;
    const msg = status === "fulfilled"
      ? "Porudžbina je poslata."
      : "Porudžbina još nije poslata.";

    res.status(200).json({ message: msg });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({
      message: "Došlo je do greške pri obradi vašeg zahteva. Molimo pokušajte kasnije ili nas kontaktirajte."
    });
  }
};
