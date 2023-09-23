from pydub import AudioSegment
from pydub.playback import play
import io
import requests
import time

one_second_silence = AudioSegment.silent(duration=500)
eleven_labs_base_url = "https://api.elevenlabs.io"

def edit_voice_settings(api_key : str,settings: object):
  """
  Edit voice settings

  Parameters:
  api_key (str): Eleven Labs API Key
  settings (obj): voice_settings
  return: HTTP status code
  """
  eleven_labs_url = eleven_labs_base_url + "/v1/voices/" + settings['id'] + "/settings/edit"
  json = {
    "stability": settings['stability'],
    "similarity_boost": settings['similarity_boost'],
  }
  r = post_request(eleven_labs_url,api_key,json)
  return r.status_code


def generate_voice(api_key: str, settings: object, text: str):
  """
  Generate and play voice from text

  Parameters:
  api_key (str): Eleven Labs API Key
  settings (obj): voice_settings
  text (str) : Text to generate voice from
  return: null
  """
  eleven_labs_url = eleven_labs_base_url + "/v1/text-to-speech/" + settings['id'] + "/stream?optimize_streaming_latency=1&output_format=mp3_44100_128"
  start = time.time()
  json = {
    "text": text,
    "model_id": "eleven_multilingual_v2",
    "language_id": "english",
    "voice_settings": {
      "stability": settings['stability'],
      "similarity_boost": settings['similarity_boost'],
      "style": settings['style'],
      "use_speaker_boost": settings['use_speaker_boost']
    }
  }

  try: 
    response = post_request(eleven_labs_url,api_key,json)
    response.raise_for_status()
  except requests.exceptions.HTTPError as err:
    print("Eleven Labs API error: " + str(err))
  else:
    audio = AudioSegment.from_file(io.BytesIO(response.content), format="mp3")
    end = time.time()
    print("audio generation(secs):" + str(end - start))
    combined = audio.append(one_second_silence, crossfade=250)
    play(combined)


def post_request(url,api_key,json):
  """
  Helper function for post

  Parameters:
  url (str) : Target Endpoint
  api_key (str): Eleven Labs API Key
  json (obj): json object for POST
  return: HTTP response
  """
  headers = {
    "accept": "*/*",
    "xi-api-key": api_key,
    "Content-Type": "application/json",
  }
  return requests.post(url, headers=headers, json = json)
# text= "My major works include twenty-one Nocturnes, four Scherzos, four Ballades, three Sonatas, two Concertos (No.1 in E minor and No.2 in F minor), twenty-four Preludes, one Fantasie-Impromptu Op. 66 and many others including smaller pieces for solo piano such as Mazurkas, Waltzes and Polonaises. My most popular works are often considered to be the Nocturnes and the Ballades due to their beautiful melodies and emotional depth. I also composed a number of chamber pieces for various ensembles such as string quartets and trios as well as vocal pieces with piano accompaniment"
# generate_voice(text)