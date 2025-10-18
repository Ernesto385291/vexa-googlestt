#!/usr/bin/env python3
"""
Standalone Google Speech-to-Text Test Application

This is a standalone Python application to test Google STT functionality
without requiring Docker or the full Vexa infrastructure.

Usage:
    python testing/standalone_google_stt_test.py

Features:
- Interactive prompts for Google credentials and language selection
- Real-time audio input from microphone
- Google STT streaming recognition
- Live transcription display
- File-based audio testing
"""

import argparse
import asyncio
import base64
import json
import os
import sys
import tempfile
import threading
import time
from datetime import datetime
from typing import Optional, Dict, Any

try:
    from google.cloud import speech
    from google.oauth2 import service_account
except ImportError:
    print("❌ Missing Google Cloud Speech dependencies.")
    print("Install with: pip install google-cloud-speech")
    sys.exit(1)

try:
    import pyaudio
    import wave
except ImportError:
    print("❌ Missing audio dependencies.")
    print("Install with: pip install pyaudio")
    sys.exit(1)

try:
    import colorama
    from colorama import Fore, Back, Style
    colorama.init()
except ImportError:
    print("⚠️  Colorama not installed. Install with: pip install colorama")
    # Fallback colors
    class Fore:
        RED = GREEN = YELLOW = BLUE = CYAN = MAGENTA = WHITE = RESET = ""
    class Style:
        BRIGHT = RESET_ALL = ""


class Colors:
    """ANSI color codes for terminal output"""
    HEADER = Fore.CYAN + Style.BRIGHT
    SUCCESS = Fore.GREEN + Style.BRIGHT
    WARNING = Fore.YELLOW + Style.BRIGHT
    ERROR = Fore.RED + Style.BRIGHT
    INFO = Fore.BLUE + Style.BRIGHT
    RESET = Style.RESET_ALL


def print_colored(message: str, color: str = Colors.INFO):
    """Print colored message"""
    print(f"{color}{message}{Colors.RESET}")


def get_user_input(prompt: str, default: str = None) -> str:
    """Get user input with optional default"""
    if default:
        user_input = input(f"{prompt} [{default}]: ").strip()
        return user_input if user_input else default
    else:
        return input(f"{prompt}: ").strip()


def load_google_credentials() -> Optional[Dict[str, Any]]:
    """Load Google credentials interactively"""
    print_colored("\n🔐 Google Cloud Credentials Setup", Colors.HEADER)
    print("You need Google Cloud Speech-to-Text API credentials.")
    print("Options:")
    print("1. Path to JSON credentials file")
    print("2. Paste JSON credentials directly")
    print("3. Use GOOGLE_APPLICATION_CREDENTIALS environment variable")
    
    choice = get_user_input("Choose option (1-3)", "1")
    
    if choice == "1":
        # File path
        creds_path = get_user_input("Enter path to Google credentials JSON file")
        if not os.path.exists(creds_path):
            print_colored(f"❌ File not found: {creds_path}", Colors.ERROR)
            return None
        
        try:
            with open(creds_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            print_colored(f"❌ Error reading credentials file: {e}", Colors.ERROR)
            return None
    
    elif choice == "2":
        # Direct JSON input
        print("\nPaste your Google credentials JSON (press Enter twice when done):")
        lines = []
        empty_lines = 0
        while True:
            line = input()
            if line.strip() == "":
                empty_lines += 1
                if empty_lines >= 2:
                    break
            else:
                empty_lines = 0
            lines.append(line)
        
        try:
            creds_json = "\n".join(lines)
            return json.loads(creds_json)
        except Exception as e:
            print_colored(f"❌ Error parsing JSON: {e}", Colors.ERROR)
            return None
    
    elif choice == "3":
        # Environment variable
        creds_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
        if not creds_path or not os.path.exists(creds_path):
            print_colored("❌ GOOGLE_APPLICATION_CREDENTIALS not set or file not found", Colors.ERROR)
            return None
        
        try:
            with open(creds_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            print_colored(f"❌ Error reading credentials from env: {e}", Colors.ERROR)
            return None
    
    else:
        print_colored("❌ Invalid choice", Colors.ERROR)
        return None


def select_language() -> str:
    """Select language for STT"""
    print_colored("\n🌍 Language Selection", Colors.HEADER)
    
    common_languages = {
        "1": "es-SV",
        "2": "es-ES", 
        "3": "en-US",
        "4": "fr-FR",
        "5": "de-DE",
        "6": "it-IT",
        "7": "pt-BR",
        "8": "ja-JP",
        "9": "ko-KR",
        "10": "zh-CN"
    }
    
    print("Common languages:")
    for key, lang in common_languages.items():
        print(f"  {key}. {lang}")
    
    choice = get_user_input("Select language (1-10) or enter custom language code", "1")
    
    if choice in common_languages:
        return common_languages[choice]
    else:
        # Custom language code
        return choice if choice else "es-SV"


def select_audio_input() -> str:
    """Select audio input method"""
    print_colored("\n🎤 Audio Input Selection", Colors.HEADER)
    print("1. Microphone (real-time)")
    print("2. Audio file")
    
    choice = get_user_input("Choose option (1-2)", "1")
    
    if choice == "2":
        file_path = get_user_input("Enter path to audio file")
        if not os.path.exists(file_path):
            print_colored(f"❌ File not found: {file_path}", Colors.ERROR)
            return None
        return file_path
    
    return "microphone"


class GoogleSTTTester:
    """Google Speech-to-Text tester"""
    
    def __init__(self, credentials: Dict[str, Any], language: str):
        self.credentials = credentials
        self.language = language
        self.client = None
        self.streaming_config = None
        self.requests = None
        self.responses = None
        self.is_recording = False
        
    def initialize(self) -> bool:
        """Initialize Google Speech client"""
        try:
            print_colored("🔧 Initializing Google Speech client...", Colors.INFO)
            
            # Create credentials object
            creds = service_account.Credentials.from_service_account_info(self.credentials)
            
            # Initialize client
            self.client = speech.SpeechClient(credentials=creds)
            
            # Configure streaming recognition
            self.streaming_config = speech.StreamingRecognitionConfig(
                config=speech.RecognitionConfig(
                    encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
                    sample_rate_hertz=16000,
                    language_code=self.language,
                    enable_automatic_punctuation=True,
                    enable_word_time_offsets=True,
                ),
                interim_results=True,
            )
            
            print_colored("✅ Google Speech client initialized successfully", Colors.SUCCESS)
            return True
            
        except Exception as e:
            print_colored(f"❌ Failed to initialize Google Speech client: {e}", Colors.ERROR)
            return False
    
    def test_microphone(self):
        """Test with microphone input"""
        print_colored("\n🎤 Starting microphone test...", Colors.HEADER)
        print("Speak into your microphone. Press Ctrl+C to stop.")
        
        # Audio configuration
        CHUNK = 1024
        FORMAT = pyaudio.paInt16
        CHANNELS = 1
        RATE = 16000
        
        # Initialize PyAudio
        audio = pyaudio.PyAudio()
        
        try:
            # Open microphone stream
            stream = audio.open(
                format=FORMAT,
                channels=CHANNELS,
                rate=RATE,
                input=True,
                frames_per_buffer=CHUNK
            )
            
            print_colored("🎤 Microphone ready. Start speaking...", Colors.SUCCESS)
            
            # Start streaming recognition
            self.requests = (speech.StreamingRecognizeRequest(audio_content=chunk)
                           for chunk in self.audio_generator(stream, CHUNK))
            
            self.responses = self.client.streaming_recognize(self.streaming_config, self.requests)
            
            # Process responses
            self.process_responses()
            
        except KeyboardInterrupt:
            print_colored("\n⏹️  Stopping microphone test...", Colors.WARNING)
        except Exception as e:
            print_colored(f"❌ Microphone test error: {e}", Colors.ERROR)
        finally:
            if 'stream' in locals():
                stream.stop_stream()
                stream.close()
            audio.terminate()
    
    def test_audio_file(self, file_path: str):
        """Test with audio file"""
        print_colored(f"\n📁 Testing audio file: {file_path}", Colors.HEADER)
        
        try:
            # Read audio file
            with wave.open(file_path, 'rb') as audio_file:
                frames = audio_file.readframes(-1)
                sample_rate = audio_file.getframerate()
                
                print_colored(f"📊 Audio file info: {sample_rate}Hz, {len(frames)} bytes", Colors.INFO)
                
                # Convert to chunks
                chunk_size = 1024 * 2  # 1024 samples * 2 bytes per sample
                audio_chunks = [frames[i:i+chunk_size] for i in range(0, len(frames), chunk_size)]
                
                # Start streaming recognition
                self.requests = (speech.StreamingRecognizeRequest(audio_content=chunk)
                               for chunk in audio_chunks)
                
                self.responses = self.client.streaming_recognize(self.streaming_config, self.requests)
                
                # Process responses
                self.process_responses()
                
        except Exception as e:
            print_colored(f"❌ Audio file test error: {e}", Colors.ERROR)
    
    def audio_generator(self, stream, chunk_size):
        """Generate audio chunks from microphone stream"""
        while self.is_recording:
            data = stream.read(chunk_size, exception_on_overflow=False)
            yield data
    
    def process_responses(self):
        """Process streaming recognition responses"""
        try:
            for response in self.responses:
                if not response.results:
                    continue
                
                result = response.results[0]
                if not result.alternatives:
                    continue
                
                transcript = result.alternatives[0].transcript
                confidence = result.alternatives[0].confidence
                is_final = result.is_final
                
                # Color code based on finality
                if is_final:
                    color = Colors.SUCCESS
                    prefix = "✅ FINAL"
                else:
                    color = Colors.WARNING
                    prefix = "🔄 INTERIM"
                
                # Format confidence
                conf_str = f"({confidence:.2f})" if confidence else "(N/A)"
                
                # Print result
                timestamp = datetime.now().strftime("%H:%M:%S")
                print_colored(f"[{timestamp}] {prefix} {conf_str}: {transcript}", color)
                
        except Exception as e:
            print_colored(f"❌ Error processing responses: {e}", Colors.ERROR)


def main():
    """Main application"""
    print_colored("🎯 Google Speech-to-Text Standalone Test", Colors.HEADER)
    print("=" * 50)
    
    # Load credentials
    credentials = load_google_credentials()
    if not credentials:
        print_colored("❌ Failed to load credentials. Exiting.", Colors.ERROR)
        return 1
    
    # Select language
    language = select_language()
    print_colored(f"🌍 Selected language: {language}", Colors.SUCCESS)
    
    # Select audio input
    audio_input = select_audio_input()
    if not audio_input:
        print_colored("❌ Invalid audio input. Exiting.", Colors.ERROR)
        return 1
    
    # Initialize tester
    tester = GoogleSTTTester(credentials, language)
    if not tester.initialize():
        return 1
    
    # Run test
    try:
        if audio_input == "microphone":
            tester.is_recording = True
            tester.test_microphone()
        else:
            tester.test_audio_file(audio_input)
            
    except KeyboardInterrupt:
        print_colored("\n👋 Test interrupted by user", Colors.WARNING)
    except Exception as e:
        print_colored(f"❌ Test failed: {e}", Colors.ERROR)
        return 1
    
    print_colored("\n✅ Test completed successfully!", Colors.SUCCESS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
