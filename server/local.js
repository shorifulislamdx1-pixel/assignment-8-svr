const app = require('../index');
const port = Number(process.env.PORT) || 5000;

app.listen(port, () => {
  console.log(`BookNook API listening on http://localhost:${port}`);
});
