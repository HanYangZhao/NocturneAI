# NocturneAI
Nocturne AI is a voice-activated chatbot that offers a unique and personalized experience. With its combination of Whisper.ai, OpenAI's GPT-3, and ElevenLabs API, Nocturne AI is capable of emulating the personality and voice of the user's chosen individual, making each interaction feel like a real conversation with that person

# Installation

## Install venv
```python -m venv venv```
### In cmd.exe
```venv\Scripts\activate.bat```
### In PowerShell
```venv\Scripts\Activate.ps1```
### In Linux/MacOs
```source venv/bin/activate```

## Install packages
For MacOs Only: ```brew install portaudio python-tk``` otherwise pyaduio install would fail.

```pip install -r requirements.txt```


## Create a .env file
```
OPEN_API_KEY=YOUR_KEY
ELEVEN_LABS_API_KEY=YOUR_KEY
```

# Run the program
```python main.py```

# Build the program to an executable
```pyinstaller main.spec```