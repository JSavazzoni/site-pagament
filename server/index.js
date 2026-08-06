'use strict';
/** Modo local: processo residente com listen + loop de cotacao. */
const app = require('./app.js');
const quote = require('./quote.js');

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Folha de pagamento rodando em http://localhost:${PORT}`);
  quote.startAutoSync();
});
