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

In Mac OS using the venv doesn't seem to work.

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
Note that you'll have to hardcode the API keys values into the code in ai.py

# Build the program to an executable for mac
```pyinstaller osx.spec```
Note that you'll have to hardcode the API keys values into the code in ai.py

# Program Settings

## Speech Recognition (WhipserAI)
**Mic Threshold** : Mic Sensitivity. Value below this level are considered silence, Value above is considered sppech. 
**Record Time (sec) **: How long to record per prompt

**Phrase timeout (sec)**: How many empty secs between recordings before we consider it a new line in the transcription.

**Speech Recog Model File**: Path to the AI model for speech recognition (WhisperAI).Smaller model will be faster at the cost of accuracy. See below for download link.


## GPT-3
**GPT3-Model** :  See : https://platform.openai.com/docs/models

**Temp** : What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic.

**MaxToken** : Maximum of tokens generated per response

**PresPenalty**: Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.

**FreqPenalty** : Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.

## Voice Generation (ElevenLabs)

**Voice Model** : ID of voice model to use

**Stability** : Increasing stability will make the voice more consistent between re-generations, but it can also make it sounda bit monotone. On longer text fragemnets we recommend lowering this value. Decreasing stability can make speech more expressvie with output varying between regenerations

**Similarity Boost**: Low value recommended if backgroudn artifacts are present in generated speech. High value boost overall voice quality but can lead to artifacts.




# WhisperAI Model Download Links
```
"tiny.en": "https://openaipublic.azureedge.net/main/whisper/models/d3dd57d32accea0b295c96e26691aa14d8822fac7d9d27d5dc00b4ca2826dd03/tiny.en.pt",
    "tiny": "https://openaipublic.azureedge.net/main/whisper/models/65147644a518d12f04e32d6f3b26facc3f8dd46e5390956a9424a650c0ce22b9/tiny.pt",
    "base.en": "https://openaipublic.azureedge.net/main/whisper/models/25a8566e1d0c1e2231d1c762132cd20e0f96a85d16145c3a00adf5d1ac670ead/base.en.pt",
    "base": "https://openaipublic.azureedge.net/main/whisper/models/ed3a0b6b1c0edf879ad9b11b1af5a0e6ab5db9205f891f668f8b0e6c6326e34e/base.pt",
    "small.en": "https://openaipublic.azureedge.net/main/whisper/models/f953ad0fd29cacd07d5a9eda5624af0f6bcf2258be67c92b79389873d91e0872/small.en.pt",
    "small": "https://openaipublic.azureedge.net/main/whisper/models/9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794/small.pt",
    "medium.en": "https://openaipublic.azureedge.net/main/whisper/models/d7440d1dc186f76616474e0ff0b3b6b879abc9d1a4926b7adfa41db2d497ab4f/medium.en.pt",
    "medium": "https://openaipublic.azureedge.net/main/whisper/models/345ae4da62f9b3d59415adc60127b97c714f32e89e936602e85993674d08dcb1/medium.pt",
    "large-v1": "https://openaipublic.azureedge.net/main/whisper/models/e4b87e7e0bf463eb8e6956e646f1e277e901512310def2c24bf0e11bd3c28e9a/large-v1.pt",
    "large-v2": "https://openaipublic.azureedge.net/main/whisper/models/81f7c96c852ee8fc832187b0132e569d6c3065a3252ed18e56effd0b6a73e524/large-v2.pt",
    "large": "https://openaipublic.azureedge.net/main/whisper/models/81f7c96c852ee8fc832187b0132e569d6c3065a3252ed18e56effd0b6a73e524/large-v2.pt",
```