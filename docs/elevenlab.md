
Real time streaming STT

Create a token

To use the client side SDK, you need to create a single use token. This can be done via the ElevenLabs API on the server side.

Never expose your API key to the client.
```
// Node.js server

app.get("/scribe-token", yourAuthMiddleware, async (req, res) => {

  const response = await fetch(

    "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",

    {

      method: "POST",

      headers: {

        "xi-api-key": process.env.ELEVENLABS_API_KEY,

      },

    }

  );

  const data = await response.json();

  res.json({ token: data.token });

});
```

Once generated, the token automatically expires after 15 minutes.

Configure the SDK

The client SDK provides two ways to transcribe audio in realtime, streaming from the microphone or manually chunking the audio.

```
// Client side

import { Scribe, RealtimeEvents } from "@elevenlabs/client";

// Ensure you have authentication headers set up

const response = await fetch("/scribe-token", yourAuthHeaders);

const { token } = await response.json();

const connection = Scribe.connect({

  token,

  modelId: "scribe_v2_realtime",

  includeTimestamps: true,

  microphone: {

    echoCancellation: true,

    noiseSuppression: true,

    autoGainControl: true,

  },

});

// Set up event handlers

// Session started

connection.on(RealtimeEvents.SESSION_STARTED, () => {

  logger.info("Session started");

});

// Partial transcripts (interim results), use this in your UI to show the live transcript

connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, (data) => {

  logger.debug("Partial:", data.text);

});

// Committed transcripts

connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, (data) => {

  logger.debug("Committed:", data.text);

});

// Committed transcripts with word-level timestamps. Only received when includeTimestamps is set to true.

connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT_WITH_TIMESTAMPS, (data) => {

  console.log("Committed:", data.text);

  console.log("Timestamps:", data.words);

});

// Errors - will catch all errors, both server and websocket specific errors

connection.on(RealtimeEvents.ERROR, (error) => {

  console.error("Error:", error);

});

// Connection opened

connection.on(RealtimeEvents.OPEN, () => {

  console.log("Connection opened");

});

// Connection closed

connection.on(RealtimeEvents.CLOSE, () => {

  console.log("Connection closed");

});

// When you are done, close the connection

connection.close();
```