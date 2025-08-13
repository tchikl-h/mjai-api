const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { openai } = require('@ai-sdk/openai');
const { generateText } = require('ai');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    console.log('Received request body:', req.body);
    
    const { playerName, playerDescription, mjMessage } = req.body;

    if (!playerName || !playerDescription || !mjMessage) {
      console.log('Missing fields:', {
        playerName: !!playerName,
        playerDescription: !!playerDescription,
        mjMessage: !!mjMessage,
      });
      return res.status(400).json({ 
        error: 'Missing required fields: playerName, playerDescription, mjMessage' 
      });
    }

    // Check for API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('OPENAI_API_KEY is not set in environment variables');
      return res.status(500).json({ 
        error: 'Server misconfiguration: OPENAI_API_KEY missing' 
      });
    }

    console.log('Creating OpenAI model...');
    const model = openai('gpt-4o', { apiKey });

    console.log('Generating text...');
    const { text } = await generateText({
      model,
      system: playerDescription,
      prompt: mjMessage,
      temperature: 0.8,
      maxTokens: 150,
    });

    console.log(`Response for ${playerName}:`, text);

    return res.status(200).json({ response: text });
  } catch (error) {
    console.error('Detailed error:', error);
    console.error('Error stack:', error?.stack || 'No stack trace');

    // Fallback response
    const name = req.body?.playerName || 'Player';
    const fallbackResponse = `*${name} nods thoughtfully*`;

    return res.status(200).json({ response: fallbackResponse, error: true });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  console.log(`Chat endpoint available at http://localhost:${PORT}/api/chat`);
});