#!/usr/bin/env python3
"""
GUI Google Speech-to-Text Test Application

This is a standalone GUI application to test Google STT functionality
without requiring Docker or the full Vexa infrastructure.

Usage:
    python testing/gui_google_stt_test.py

Features:
- Visual GUI interface with tkinter
- Google credentials file selection
- Language selection dropdown
- Real-time audio input from microphone
- Live transcription display
- Audio file testing support
- Visual feedback and status indicators
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox, scrolledtext
import threading
import json
import os
import sys
import time
from datetime import datetime
from typing import Optional, Dict, Any

try:
    from google.cloud import speech
    from google.oauth2 import service_account
except ImportError:
    messagebox.showerror("Missing Dependencies", 
                        "Google Cloud Speech dependencies not found.\n"
                        "Install with: pip install google-cloud-speech")
    sys.exit(1)

try:
    import pyaudio
    import wave
except ImportError:
    messagebox.showerror("Missing Dependencies", 
                        "Audio dependencies not found.\n"
                        "Install with: pip install pyaudio")
    sys.exit(1)


class GoogleSTTGUI:
    """Google Speech-to-Text GUI Application"""
    
    def __init__(self, root):
        self.root = root
        self.root.title("Google Speech-to-Text Test")
        self.root.geometry("800x600")
        self.root.configure(bg='#f0f0f0')
        
        # STT components
        self.client = None
        self.streaming_config = None
        self.requests = None
        self.responses = None
        self.is_recording = False
        self.audio_stream = None
        self.audio = None
        
        # Status
        self.status_var = tk.StringVar(value="Ready")
        
        # GUI components
        self.setup_gui()
        
        self.update_status("Ready")
        
    def setup_gui(self):
        """Setup the GUI components"""
        # Main frame
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Configure grid weights
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(0, weight=1)
        main_frame.columnconfigure(1, weight=1)
        
        # Title
        title_label = ttk.Label(main_frame, text="Google Speech-to-Text Test", 
                               font=('Arial', 16, 'bold'))
        title_label.grid(row=0, column=0, columnspan=2, pady=(0, 20))
        
        # Credentials section
        self.setup_credentials_section(main_frame, 1)
        
        # Language section
        self.setup_language_section(main_frame, 2)
        
        # Audio input section
        self.setup_audio_section(main_frame, 3)
        
        # Control buttons
        self.setup_control_buttons(main_frame, 4)
        
        # Transcription display
        self.setup_transcription_display(main_frame, 5)
        
        # Status bar
        self.setup_status_bar(main_frame, 6)
        
    def setup_credentials_section(self, parent, row):
        """Setup credentials selection section"""
        # Credentials frame
        cred_frame = ttk.LabelFrame(parent, text="Google Cloud Credentials", padding="10")
        cred_frame.grid(row=row, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        cred_frame.columnconfigure(1, weight=1)
        
        # File path
        ttk.Label(cred_frame, text="Credentials File:").grid(row=0, column=0, sticky=tk.W, padx=(0, 10))
        
        self.creds_path_var = tk.StringVar()
        self.creds_entry = ttk.Entry(cred_frame, textvariable=self.creds_path_var, width=50)
        self.creds_entry.grid(row=0, column=1, sticky=(tk.W, tk.E), padx=(0, 10))
        
        # Browse button
        ttk.Button(cred_frame, text="Browse", 
                  command=self.browse_credentials).grid(row=0, column=2)
        
        # Test button
        ttk.Button(cred_frame, text="Test Connection", 
                  command=self.test_credentials).grid(row=0, column=3, padx=(10, 0))
        
    def setup_language_section(self, parent, row):
        """Setup language selection section"""
        # Language frame
        lang_frame = ttk.LabelFrame(parent, text="Language Settings", padding="10")
        lang_frame.grid(row=row, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        
        # Language selection
        ttk.Label(lang_frame, text="Language:").grid(row=0, column=0, sticky=tk.W, padx=(0, 10))
        
        self.language_var = tk.StringVar(value="es-SV")
        language_combo = ttk.Combobox(lang_frame, textvariable=self.language_var, 
                                    values=[
                                        "es-SV", "es-ES", "en-US", "fr-FR", "de-DE", "it-IT",
                                        "pt-BR", "ja-JP", "ko-KR", "zh-CN", "zh-TW",
                                        "ru-RU", "ar-SA", "hi-IN", "th-TH", "vi-VN"
                                    ], state="readonly", width=20)
        language_combo.grid(row=0, column=1, sticky=tk.W)
        
    def setup_audio_section(self, parent, row):
        """Setup audio input section"""
        # Audio frame
        audio_frame = ttk.LabelFrame(parent, text="Audio Input", padding="10")
        audio_frame.grid(row=row, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        audio_frame.columnconfigure(1, weight=1)
        
        # Audio input type
        self.audio_type_var = tk.StringVar(value="microphone")
        
        ttk.Radiobutton(audio_frame, text="Microphone", variable=self.audio_type_var, 
                       value="microphone").grid(row=0, column=0, sticky=tk.W, padx=(0, 20))
        ttk.Radiobutton(audio_frame, text="Audio File", variable=self.audio_type_var, 
                       value="file").grid(row=0, column=1, sticky=tk.W)
        
        # File selection (hidden initially)
        self.file_frame = ttk.Frame(audio_frame)
        self.file_frame.grid(row=1, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=(10, 0))
        self.file_frame.columnconfigure(1, weight=1)
        
        ttk.Label(self.file_frame, text="Audio File:").grid(row=0, column=0, sticky=tk.W, padx=(0, 10))
        
        self.audio_file_var = tk.StringVar()
        self.audio_file_entry = ttk.Entry(self.file_frame, textvariable=self.audio_file_var, width=50)
        self.audio_file_entry.grid(row=0, column=1, sticky=(tk.W, tk.E), padx=(0, 10))
        
        ttk.Button(self.file_frame, text="Browse", 
                  command=self.browse_audio_file).grid(row=0, column=2)
        
        # Hide file frame initially
        self.file_frame.grid_remove()
        
        # Bind radio button changes
        self.audio_type_var.trace('w', self.on_audio_type_change)
        
    def setup_control_buttons(self, parent, row):
        """Setup control buttons"""
        # Control frame
        control_frame = ttk.Frame(parent)
        control_frame.grid(row=row, column=0, columnspan=2, pady=10)
        
        # Start/Stop button
        self.start_button = ttk.Button(control_frame, text="Start Recording", 
                                      command=self.toggle_recording, style="Accent.TButton")
        self.start_button.pack(side=tk.LEFT, padx=(0, 10))
        
        # Clear button
        ttk.Button(control_frame, text="Clear Text", 
                  command=self.clear_transcription).pack(side=tk.LEFT, padx=(0, 10))
        
        # Save button
        ttk.Button(control_frame, text="Save Transcript", 
                  command=self.save_transcript).pack(side=tk.LEFT)
        
    def setup_transcription_display(self, parent, row):
        """Setup transcription display"""
        # Transcription frame
        trans_frame = ttk.LabelFrame(parent, text="Transcription Results", padding="10")
        trans_frame.grid(row=row, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=5)
        trans_frame.columnconfigure(0, weight=1)
        trans_frame.rowconfigure(0, weight=1)
        parent.rowconfigure(row, weight=1)
        
        # Text display
        self.transcription_text = scrolledtext.ScrolledText(trans_frame, height=15, width=80,
                                                           font=('Consolas', 10))
        self.transcription_text.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Configure text tags for formatting
        self.transcription_text.tag_configure("final", foreground="green", font=('Consolas', 10, 'bold'))
        self.transcription_text.tag_configure("interim", foreground="orange", font=('Consolas', 10))
        self.transcription_text.tag_configure("timestamp", foreground="blue", font=('Consolas', 9))
        self.transcription_text.tag_configure("confidence", foreground="purple", font=('Consolas', 9))
        
    def setup_status_bar(self, parent, row):
        """Setup status bar"""
        # Status frame
        status_frame = ttk.Frame(parent)
        status_frame.grid(row=row, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=(10, 0))
        status_frame.columnconfigure(0, weight=1)
        
        # Status label
        self.status_label = ttk.Label(status_frame, textvariable=self.status_var, 
                                    relief=tk.SUNKEN, anchor=tk.W)
        self.status_label.grid(row=0, column=0, sticky=(tk.W, tk.E))
        
    def browse_credentials(self):
        """Browse for credentials file"""
        filename = filedialog.askopenfilename(
            title="Select Google Credentials JSON File",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
        )
        if filename:
            self.creds_path_var.set(filename)
            
    def browse_audio_file(self):
        """Browse for audio file"""
        filename = filedialog.askopenfilename(
            title="Select Audio File",
            filetypes=[
                ("Audio files", "*.wav *.mp3 *.flac *.m4a"),
                ("WAV files", "*.wav"),
                ("All files", "*.*")
            ]
        )
        if filename:
            self.audio_file_var.set(filename)
            
    def on_audio_type_change(self, *args):
        """Handle audio type change"""
        if self.audio_type_var.get() == "file":
            self.file_frame.grid()
        else:
            self.file_frame.grid_remove()
            
    def test_credentials(self):
        """Test Google credentials"""
        creds_path = self.creds_path_var.get()
        if not creds_path:
            messagebox.showerror("Error", "Please select a credentials file")
            return
            
        if not os.path.exists(creds_path):
            messagebox.showerror("Error", "Credentials file not found")
            return
            
        try:
            self.update_status("Testing credentials...")
            
            # Load credentials
            with open(creds_path, 'r') as f:
                credentials = json.load(f)
                
            # Create credentials object
            creds = service_account.Credentials.from_service_account_info(credentials)
            
            # Initialize client
            client = speech.SpeechClient(credentials=creds)
            
            # Test with a simple request
            config = speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
                sample_rate_hertz=16000,
                language_code="en-US",
            )
            
            # Create a minimal audio (silence)
            audio = speech.RecognitionAudio(content=b'\x00' * 3200)  # 0.1 seconds of silence
            
            # This will fail gracefully if credentials are invalid
            client.recognize(config=config, audio=audio)
            
            messagebox.showinfo("Success", "Credentials are valid!")
            self.update_status("Credentials validated")
            
        except Exception as e:
            messagebox.showerror("Error", f"Credentials test failed: {str(e)}")
            self.update_status("Credentials test failed")
            
    def initialize_stt_client(self):
        """Initialize STT client"""
        creds_path = self.creds_path_var.get()
        if not creds_path or not os.path.exists(creds_path):
            messagebox.showerror("Error", "Please select a valid credentials file")
            return False
            
        try:
            # Load credentials
            with open(creds_path, 'r') as f:
                credentials = json.load(f)
                
            # Create credentials object
            creds = service_account.Credentials.from_service_account_info(credentials)
            
            # Initialize client
            self.client = speech.SpeechClient(credentials=creds)
            
            # Configure streaming recognition
            self.streaming_config = speech.StreamingRecognitionConfig(
                config=speech.RecognitionConfig(
                    encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
                    sample_rate_hertz=16000,
                    language_code=self.language_var.get(),
                    enable_automatic_punctuation=True,
                    enable_word_time_offsets=True,
                ),
                interim_results=True,
            )
            
            return True
            
        except Exception as e:
            messagebox.showerror("Error", f"Failed to initialize STT client: {str(e)}")
            return False
            
    def toggle_recording(self):
        """Toggle recording state"""
        if not self.is_recording:
            self.start_recording()
        else:
            self.stop_recording()
            
    def start_recording(self):
        """Start recording"""
        if not self.initialize_stt_client():
            return
            
        self.is_recording = True
        self.start_button.config(text="Stop Recording")
        self.update_status("Recording...")
        
        # Start recording in separate thread
        if self.audio_type_var.get() == "microphone":
            self.recording_thread = threading.Thread(target=self.record_microphone)
        else:
            self.recording_thread = threading.Thread(target=self.record_file)
            
        self.recording_thread.daemon = True
        self.recording_thread.start()
        
    def stop_recording(self):
        """Stop recording"""
        self.is_recording = False
        self.start_button.config(text="Start Recording")
        self.update_status("Stopped")
        
        # Stop audio stream
        if self.audio_stream:
            self.audio_stream.stop_stream()
            self.audio_stream.close()
            self.audio_stream = None
            
        if self.audio:
            self.audio.terminate()
            self.audio = None
            
    def record_microphone(self):
        """Record from microphone"""
        try:
            # Audio configuration
            CHUNK = 1024
            FORMAT = pyaudio.paInt16
            CHANNELS = 1
            RATE = 16000
            
            # Initialize PyAudio
            self.audio = pyaudio.PyAudio()
            
            # Open microphone stream
            self.audio_stream = self.audio.open(
                format=FORMAT,
                channels=CHANNELS,
                rate=RATE,
                input=True,
                frames_per_buffer=CHUNK
            )
            
            # Start streaming recognition
            self.requests = (speech.StreamingRecognizeRequest(audio_content=chunk)
                           for chunk in self.audio_generator(self.audio_stream, CHUNK))
            
            self.responses = self.client.streaming_recognize(self.streaming_config, self.requests)
            
            # Process responses
            self.process_responses()
            
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("Error", f"Microphone recording failed: {str(e)}"))
            self.root.after(0, self.stop_recording)
            
    def record_file(self):
        """Record from audio file"""
        file_path = self.audio_file_var.get()
        if not file_path or not os.path.exists(file_path):
            self.root.after(0, lambda: messagebox.showerror("Error", "Please select a valid audio file"))
            self.root.after(0, self.stop_recording)
            return
            
        try:
            # Read audio file
            with wave.open(file_path, 'rb') as audio_file:
                frames = audio_file.readframes(-1)
                sample_rate = audio_file.getframerate()
                
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
            self.root.after(0, lambda: messagebox.showerror("Error", f"Audio file processing failed: {str(e)}"))
            self.root.after(0, self.stop_recording)
            
    def audio_generator(self, stream, chunk_size):
        """Generate audio chunks from microphone stream"""
        while self.is_recording:
            data = stream.read(chunk_size, exception_on_overflow=False)
            yield data
            
    def process_responses(self):
        """Process streaming recognition responses"""
        try:
            for response in self.responses:
                if not self.is_recording:
                    break
                    
                if not response.results:
                    continue
                
                result = response.results[0]
                if not result.alternatives:
                    continue
                
                transcript = result.alternatives[0].transcript
                confidence = result.alternatives[0].confidence
                is_final = result.is_final
                
                # Update GUI in main thread
                self.root.after(0, lambda: self.update_transcription(transcript, confidence, is_final))
                
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("Error", f"Response processing failed: {str(e)}"))
            self.root.after(0, self.stop_recording)
            
    def update_transcription(self, transcript, confidence, is_final):
        """Update transcription display"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        conf_str = f"({confidence:.2f})" if confidence else "(N/A)"
        
        # Insert timestamp
        self.transcription_text.insert(tk.END, f"[{timestamp}] ", "timestamp")
        
        # Insert confidence
        self.transcription_text.insert(tk.END, f"{conf_str} ", "confidence")
        
        # Insert transcript with appropriate tag
        tag = "final" if is_final else "interim"
        self.transcription_text.insert(tk.END, f"{transcript}\n", tag)
        
        # Scroll to bottom
        self.transcription_text.see(tk.END)
        
    def clear_transcription(self):
        """Clear transcription text"""
        self.transcription_text.delete(1.0, tk.END)
        
    def save_transcript(self):
        """Save transcription to file"""
        content = self.transcription_text.get(1.0, tk.END)
        if not content.strip():
            messagebox.showwarning("Warning", "No transcription to save")
            return
            
        filename = filedialog.asksaveasfilename(
            title="Save Transcription",
            defaultextension=".txt",
            filetypes=[("Text files", "*.txt"), ("All files", "*.*")]
        )
        
        if filename:
            try:
                with open(filename, 'w', encoding='utf-8') as f:
                    f.write(content)
                messagebox.showinfo("Success", f"Transcription saved to {filename}")
            except Exception as e:
                messagebox.showerror("Error", f"Failed to save file: {str(e)}")
                
    def update_status(self, message):
        """Update status bar"""
        self.status_var.set(message)
        
    def on_closing(self):
        """Handle window closing"""
        if self.is_recording:
            self.stop_recording()
        self.root.destroy()


def main():
    """Main application"""
    root = tk.Tk()
    app = GoogleSTTGUI(root)
    
    # Handle window closing
    root.protocol("WM_DELETE_WINDOW", app.on_closing)
    
    # Start the GUI
    root.mainloop()


if __name__ == "__main__":
    main()
