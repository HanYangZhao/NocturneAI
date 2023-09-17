import time
from dotenv import load_dotenv
import audio
import os
import openai
from sys import platform
from time import sleep
from tempfile import NamedTemporaryFile
from queue import Queue
from datetime import datetime, timedelta
import io
import speech_recognition as sr
import whisper
from whisper import _download, _MODELS
import torch
import warnings
warnings.filterwarnings("ignore")
load_dotenv()

openai.api_key = os.getenv('OPENAI_API_KEY')
eleven_labs_api_key = os.getenv('ELEVEN_LABS_API_KEY')

def generate_response_ai(message: str, gpt3_params: object):
    """
    Generate response from GPT3

    Parameters:

    Prompt (str): Prompt Text
    gpt3_params (obj): gpt3_settings

    return: GPT3 reponse
    """
    response = openai.ChatCompletion.create(
        model=gpt3_params['model'],
        messages=message,
        temperature=float(gpt3_params['temp']),
        max_tokens=int(gpt3_params['max_tokens']),
        top_p=1,
        frequency_penalty=float(gpt3_params['presence_penalty']),
        presence_penalty=float(gpt3_params['frequency_penalty'])
    )
    return response

#phrase_timeout : "How much empty space between recordings before we consider it a new line in the transcription."


def start(model_file_path: str, record_timeout: int, phrase_timeout: int, energy_threshold: int, initial_prompt: str, 
  gpt3_settings: object, voice_settings: object):
    """
    Start the Speech Regonition

    Parameters:

    model_file_path (str): Model file path
    record_timeout(int): How real time the recording is in seconds.
    phrase_timeout(int): How many empty secs between recordings before we consider it a new line in the transcription.
    energy_threshold(int): Energy level for mic to detect (150-3500)
    initial_prompt(str): initial_prompt
    gpt3_settings (obj): gpt3_settings
    voice_settings (obj): voice_settings

    return: null
    """

    # if 'linux' in platform:
    #     parser.add_argument("--default_microphone", default='pulse',
    #                         help="Default microphone name for SpeechRecognition. "
    #                              "Run this with 'list' to view available Microphones.", type=str)

    # The last time a recording was retreived from the queue.
    phrase_time = None
    # Current raw audio bytes.
    last_sample = bytes()
    # Thread safe Queue for passing data from the threaded recording callback.
    data_queue = Queue()
    # We use SpeechRecognizer to record our audio because it has a nice feauture where it can detect when speech ends.
    recorder = sr.Recognizer()
    recorder.energy_threshold = energy_threshold
    # Definitely do this, dynamic energy compensation lowers the energy threshold dramtically to a point where the SpeechRecognizer never stops recording.
    recorder.dynamic_energy_threshold = False

    # Important for linux users.
    # Prevents permanent application hang and crash by using the wrong Microphone
    if 'linux' in platform:
        mic_name = "pulse"
        if not mic_name or mic_name == 'list':
            print("Available microphone devices are: ")
            for index, name in enumerate(sr.Microphone.list_microphone_names()):
                print(f"Microphone with name \"{name}\" found")
            return
        else:
            for index, name in enumerate(sr.Microphone.list_microphone_names()):
                if mic_name in name:
                    source = sr.Microphone(
                        sample_rate=16000, device_index=index)
                    break
    else:
        source = sr.Microphone(sample_rate=16000)

    # Load / Download model
    # model = model
    # if model != "large":
    #    model = model + ".en"
    # _download(_MODELS[model], model_folder, False)
    # folder,file = os.path.split(model_file_path)
    # file = ".".join(file.split(".", 2)[:2]) #split the filename at the second ., take the first 2 elements then join them with .
    # print(file)
    audio_model = whisper.load_model(model_file_path, in_memory=True)
    print("Model loaded. Ready to start. Ask Away! \n")

    record_timeout = record_timeout
    phrase_timeout = phrase_timeout

    temp_file = NamedTemporaryFile().name
    transcription = ['']

    with source:
      recorder.adjust_for_ambient_noise(source)

    def record_callback(_, audio: sr.AudioData) -> None:
      """
      Threaded callback function to recieve audio data when recordings finish.
      audio: An AudioData containing the recorded bytes.
      """
      # Grab the raw bytes and push it into the thread safe queue.
      data = audio.get_raw_data()
      data_queue.put(data)

    # Create a background thread that will pass us raw audio bytes.
    # We could do this manually but SpeechRecognizer provides a nice helper.
    recorder.listen_in_background(
      source, record_callback, phrase_time_limit=record_timeout)

    # Cue the user that we're ready to go.
    status = audio.edit_voice_settings(eleven_labs_api_key,voice_settings)
    if(status == 200):
      print("ElevenAI API connection success")
      print('', end='', flush=True)
    else:
      print( "ElevenAI API connection failed: " +  str(status))
      print('', end='', flush=True)

    current_text = []
    restart_sequence = "\n\n"
    while True:
        try:
            now = datetime.utcnow()
            # Pull raw recorded audio from the queue.
            if not data_queue.empty():
                phrase_complete = False
                # If enough time has passed between recordings, consider the phrase complete.
                # Clear the current working audio buffer to start over with the new data.
                if phrase_time and now - phrase_time > timedelta(seconds=phrase_timeout):
                    last_sample = bytes()
                    phrase_complete = True
                # This is the last time we received new audio data from the queue.
                phrase_time = now

                # Concatenate our current audio data with the latest audio data.
                while not data_queue.empty():
                    data = data_queue.get()
                    last_sample += data

                # Use AudioData to convert the raw data to wav data.
                audio_data = sr.AudioData(
                    last_sample, source.SAMPLE_RATE, source.SAMPLE_WIDTH)
                wav_data = io.BytesIO(audio_data.get_wav_data())

                # Write wav data to the temporary file as bytes.
                with open(temp_file, 'w+b') as f:
                    f.write(wav_data.read())

                # Read the transcription.
                result = audio_model.transcribe(
                    temp_file, fp16=torch.cuda.is_available())
                text = result['text'].strip()

                # If we detected a pause between recordings, add a new item to our transcripion.
                # Otherwise edit the existing one.
                if phrase_complete:
                    transcription.append(text)

                    # Flush stdout.

                else:
                    transcription[-1] = text
                # Clear the console to reprint the updated transcription.
                # os.system('cls' if os.name=='nt' else 'clear')
                # for i,line in enumerate(transcription):
                #     print(str(i) + " " + line)
                #     print('', end='', flush=True)

                # Infinite loops are bad for processors, must sleep.
                if text:
                    start = time.time()
                    print("\nQ:" + text)
                    print(current_text)
                    if len(current_text) < 1:
                        current_text = [{"role": "system", "content": initial_prompt}]
                    current_text.append({"role": "user", "content": text})
                    # print("")
                    # print("Prompt: " +  prompt)
                    # print("")
                    r = generate_response_ai(current_text, gpt3_settings)
                    end = time.time()

                    response_text = r['choices'][0]['message']['content']
                    # # if if '(' in my_string:
                    # if ':' in response_text:
                    #     response_text = response_text.split(":")[1]
                    current_text.append({"role": "assistant", "content": response_text})
                    audio.generate_voice(
                         eleven_labs_api_key, voice_settings, response_text)
                    print("response generation(secs):" + str(end - start))
                    print("\nA : " + str(response_text.encode('utf-8')))
                    print("total token: " +
                          str(r['usage']['total_tokens']) + "\n")
                sleep(0.01)
        except KeyboardInterrupt:
            break

    # print("\n\n Complete Transcription:")
    # for i in range(min(len(transcription), len(response))):
    #     print("Q: " + transcription[i])
    #     print(response[i])
    #     print("")
    #     print("")
