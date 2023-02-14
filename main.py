import PySimpleGUI as sg
import ai
import threading
from time import sleep
sg.theme("DarkBlue3")
sg.set_options(font=("Courier New", 14))

version = "0.1"

layout = [
  [sg.Text("Nocturne AI " + version + "\n", justification="center", key="-TITLE-")],
  [
    sg.Text("Mic Threshold (150-3500):"),
    sg.Input("2000", size=(5, 1), justification="right", background_color="green", key="-MIC_THRESHOLD-")
  ],
  [
    sg.Text("Record Time (secs):"),
    sg.Input("3", size=(2, 1), justification="right", background_color="green", key="-RECORD_TIME-")],
  [
    sg.Text("Phrase Timeout (secs):"),
    sg.Input("1", size=(2, 1), key="-PHRASE_TIMEOUT-",background_color="green"),
  ],
  [
    sg.Text("SR model size (tiny,base,small,medium,large) :"),
    sg.Input("base", size=(7, 1), key="-MODEL_SIZE-",background_color="green"),
  ],
  [
    sg.Text("GPT3 Model:"),
    sg.Input("text-davinci-003", size=(8, 1), key="-GPT3_MODEL-",background_color="green"),
    sg.Text("Temp(0-1):"),
    sg.Input("0.8", size=(3, 1), key="-GPT3_TEMP-",background_color="green"),
    sg.Text("MaxTokens:"),
    sg.Input("100", size=(3, 1), key="-GPT3_MAX_TOKENS-",background_color="green"),
    sg.Text("PresPenalty(0-1):"),
    sg.Input("0.61", size=(3, 1), key="-GPT3_PRESENCE_PENALTY-",background_color="green"),
    sg.Text("FreqPenalty(0-1):"),
    sg.Input("0.5", size=(3, 1), key="-GPT3_FREQUENCY_PENALTY-",background_color="green"),
  ],
  [
    sg.Text("Voice Model:"),
    sg.Input("W7Ypc75k2rzNtANFrmrl", size=(8, 1), key="-VOICE_ID-",background_color="green"),
    sg.Text("Stability (0-1):"),
    sg.Input("0.5", size=(3, 1), key="-VOICE_STABILITY-",background_color="green"),
    sg.Text("Similarity Boost (0-1):"),
    sg.Input("0.75", size=(3, 1), key="-VOICE_SIMILARITY_BOOST-",background_color="green"),

  ],
  [

  ],
  [sg.Text("Artist: "),sg.Input("Frederic Chopin", size=(15, 1), key="-ARTIST-",background_color="green"),],
  [sg.Text("", size=(40, 1))],
  [sg.Button("Start")],
  [sg.Text("", size=(40, 1))],
  [sg.Text("Output:", size=(40, 1))],
  [sg.Output(size=(100, 20), font="Courier 12")],
]

window = sg.Window("Nocturne AI " + version + "\n", layout, finalize=True)
window["-TITLE-"].expand(expand_x=True)

while True:
  event, values = window.read()
  if event == sg.WIN_CLOSED or event == "Cancel": # if user closes window or clicks cancel
    break
  if event == "Start":
    window["Start"].update(disabled=True)
    window["-MIC_THRESHOLD-"].update(disabled=True)
    window["-RECORD_TIME-"].update(disabled=True)
    window["-PHRASE_TIMEOUT-"].update(disabled=True)
    window["-MODEL_SIZE-"].update(disabled=True)
    window["-ARTIST-"].update(disabled=True)
    window["-GPT3_MODEL-"].update(disabled=True)
    window["-GPT3_TEMP-"].update(disabled=True)
    window["-GPT3_MAX_TOKENS-"].update(disabled=True)
    window["-GPT3_PRESENCE_PENALTY-"].update(disabled=True)
    window["-GPT3_FREQUENCY_PENALTY-"].update(disabled=True)
    window["-VOICE_ID-"].update(disabled=True)
    window["-VOICE_STABILITY-"].update(disabled=True)
    window["-VOICE_SIMILARITY_BOOST-"].update(disabled=True)
    mic_threshold = int(values["-MIC_THRESHOLD-"])
    record_time = int(values["-RECORD_TIME-"])
    phrase_timeout = int(values["-PHRASE_TIMEOUT-"])
    model_size = values["-MODEL_SIZE-"]
    artist = values["-ARTIST-"]
    gpt3_settings = {
      "model": values["-GPT3_MODEL-"],
      "temp": values["-GPT3_TEMP-"],
      "max_tokens": values["-GPT3_MAX_TOKENS-"],
      "presence_penalty" : values["-GPT3_PRESENCE_PENALTY-"],
      "frequency_penalty" :values["-GPT3_FREQUENCY_PENALTY-"],
    }
    voice_settings = {
      "id": values["-VOICE_ID-"],
      "stability": values["-VOICE_STABILITY-"],
      "similarity_boost": values["-VOICE_SIMILARITY_BOOST-"]
    }
    threading.Thread(target=ai.start, args=(model_size,record_time,phrase_timeout,mic_threshold,artist,gpt3_settings,voice_settings), daemon=True).start()

  sleep(0.01)