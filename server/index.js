'use strict';
const app = require('./app.js');
const quote = require('./quote.js');

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Folha de pagamento rodando em http://localhost:${PORT}`);
  quote.startAutoSync();
});
