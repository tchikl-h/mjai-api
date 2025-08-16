const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const { openai } = require('@ai-sdk/openai');
const { streamText } = require('ai');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 3 * 1024 * 1024 * 1024, // 3GB limit as per ElevenLabs
  },
});

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

    console.log('Streaming text...');
    const result = await streamText({
      model,
      system: playerDescription,
      prompt: mjMessage,
      temperature: 0.8,
      maxTokens: 150,
    });

    // Set headers for Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    console.log(`Streaming response for ${playerName}...`);

    // Stream the response token by token
    for await (const delta of result.textStream) {
      res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
    }

    // Send end signal
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Detailed error:', error);
    console.error('Error stack:', error?.stack || 'No stack trace');

    // Fallback response
    const name = req.body?.playerName || 'Player';
    const fallbackResponse = `*${name} nods thoughtfully*`;

    return res.status(200).json({ response: fallbackResponse, error: true });
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const { voiceId, text, voice_settings } = req.body;
    const apiKey = process.env.ELEVENLABS_API_KEY;

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model: 'eleven_flash_v2_5',
        voice_settings: voice_settings || {
          stability: 0.4,
          similarity_boost: 0.9,
          style: 0,
          use_speaker_boost: true
        }
      })
    });

    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: 'TTS failed' });
  }
});

// Voice design endpoint
app.post('/api/voice-design', async (req, res) => {
  try {
    const { 
      voice_description, 
      model_id,
      text,
      auto_generate_text,
      loudness,
      seed,
      guidance_scale,
      stream_previews,
      quality,
      reference_audio_base64,
      prompt_strength
    } = req.body;

    // Check for required parameters
    if (!voice_description) {
      return res.status(400).json({ error: 'voice_description is required' });
    }

    // Validate voice_description length
    if (voice_description.length < 20 || voice_description.length > 1000) {
      return res.status(400).json({ 
        error: 'voice_description must be between 20-1000 characters' 
      });
    }

    // Check for API key
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('ELEVENLABS_API_KEY is not set in environment variables');
      return res.status(500).json({ 
        error: 'Server misconfiguration: ELEVENLABS_API_KEY missing' 
      });
    }

    console.log(`Processing voice design request for description: "${voice_description.substring(0, 50)}..."`);

    // Build request body with optional parameters
    const requestBody = {
      voice_description,
      model_id: model_id || 'eleven_multilingual_ttv_v2',
      auto_generate_text: auto_generate_text || false,
      loudness: loudness !== undefined ? loudness : 0.5,
      guidance_scale: guidance_scale !== undefined ? guidance_scale : 5
    };

    // Add optional parameters if provided
    if (text) requestBody.text = text;
    if (seed !== undefined) requestBody.seed = seed;
    if (stream_previews !== undefined) requestBody.stream_previews = stream_previews;
    if (quality !== undefined) requestBody.quality = quality;
    if (reference_audio_base64) requestBody.reference_audio_base64 = reference_audio_base64;
    if (prompt_strength !== undefined) requestBody.prompt_strength = prompt_strength;

    const response = await fetch('https://api.elevenlabs.io/v1/text-to-voice/design', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('ElevenLabs API error:', response.status, errorData);
      return res.status(response.status).json({ 
        error: `Voice design failed: ${response.statusText}`,
        details: errorData
      });
    }

    const result = await response.json();
    console.log('Voice design completed successfully');
    
    return res.status(200).json(result);
  } catch (error) {
    console.error('Voice design error:', error);
    return res.status(500).json({ 
      error: 'Voice design processing failed',
      details: error.message 
    });
  }
});

// Speech-to-text endpoint
app.post('/api/stt', upload.single('audio'), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Check for API key
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('ELEVENLABS_API_KEY is not set in environment variables');
      return res.status(500).json({ 
        error: 'Server misconfiguration: ELEVENLABS_API_KEY missing' 
      });
    }

    // Get parameters from request body - model_id is required
    const modelId = req.body.model_id || 'scribe_v1';
    const languageCode = req.body.language_code;
    const numSpeakers = req.body.num_speakers;
    const diarize = req.body.diarize;
    const tagAudioEvents = req.body.tag_audio_events;

    console.log(`Processing speech-to-text for file: ${req.file.originalname}, size: ${req.file.size} bytes, model: ${modelId}`);
    console.log('Request body params:', req.body);

    // Create FormData for the API request using the form-data package
    const FormDataLib = require('form-data');
    const formData = new FormDataLib();
    
    // Add model_id (required parameter)
    formData.append('model_id', modelId);
    
    // Add the file buffer as a stream
    formData.append('file', req.file.buffer, {
      filename: req.file.originalname || 'audio.wav',
      contentType: req.file.mimetype || 'audio/wav'
    });

    // Add optional parameters if provided
    if (languageCode) formData.append('language_code', languageCode);
    if (numSpeakers) formData.append('num_speakers', numSpeakers);
    if (diarize !== undefined) formData.append('diarize', diarize);
    if (tagAudioEvents !== undefined) formData.append('tag_audio_events', tagAudioEvents);

    console.log('Making request to ElevenLabs API...');

    // Use axios for better form-data handling
    const axios = require('axios');
    
    try {
      const response = await axios.post('https://api.elevenlabs.io/v1/speech-to-text', formData, {
        headers: {
          'xi-api-key': apiKey,
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      console.log('Speech-to-text completed successfully');
      return res.status(200).json(response.data);
      
    } catch (axiosError) {
      console.error('Axios error:', axiosError.response?.status, axiosError.response?.data);
      return res.status(axiosError.response?.status || 500).json({ 
        error: `Speech-to-text failed: ${axiosError.response?.statusText || axiosError.message}`,
        details: axiosError.response?.data || axiosError.message
      });
    }
  } catch (error) {
    console.error('Speech-to-text error:', error);
    return res.status(500).json({ 
      error: 'Speech-to-text processing failed',
      details: error.message 
    });
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
  console.log(`TTS endpoint available at http://localhost:${PORT}/api/tts`);
  console.log(`Voice Design endpoint available at http://localhost:${PORT}/api/voice-design`);
  console.log(`STT endpoint available at http://localhost:${PORT}/api/stt`);
});