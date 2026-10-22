require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS for local frontend development
app.use(cors({
  origin: 'http://localhost:5500',
  credentials: true
}));

// Express JSON body parser
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'CampusSwap API is running'
  });
});

app.listen(PORT, () => {
  console.log(`CampusSwap backend server running on port ${PORT}`);
});
