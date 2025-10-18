# Standalone Google STT Test Application

This is a standalone Python application to test Google Speech-to-Text functionality without requiring Docker or the full Vexa infrastructure.

## Features

- ✅ Interactive prompts for Google credentials and language selection
- ✅ Real-time audio input from microphone
- ✅ Audio file testing support
- ✅ Google STT streaming recognition
- ✅ Live transcription display with confidence scores
- ✅ Color-coded output for better readability

## Installation

### 1. Install Python Dependencies

```bash
# Install required packages
pip install -r testing/requirements_standalone.txt
```

**Note for macOS users:**

```bash
# Install PyAudio dependencies first
brew install portaudio
pip install pyaudio
```

### 2. Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Speech-to-Text API
4. Create a service account with Speech-to-Text permissions
5. Download the JSON credentials file

## Usage

### Run the Test Application

```bash
python testing/standalone_google_stt_test.py
```

### Interactive Setup

The application will guide you through:

1. **Credentials Setup**: Choose how to provide Google credentials

   - Path to JSON file
   - Paste JSON directly
   - Use environment variable

2. **Language Selection**: Choose from common languages or enter custom code

   - en-US, es-ES, fr-FR, de-DE, etc.

3. **Audio Input**: Choose input method
   - Microphone (real-time)
   - Audio file

### Example Session

```
🎯 Google Speech-to-Text Standalone Test
==================================================

🔐 Google Cloud Credentials Setup
You need Google Cloud Speech-to-Text API credentials.
Options:
1. Path to JSON credentials file
2. Paste JSON credentials directly
3. Use GOOGLE_APPLICATION_CREDENTIALS environment variable
Choose option (1-3) [1]: 1
Enter path to Google credentials JSON file: /path/to/credentials.json

🌍 Language Selection
Common languages:
  1. en-US
  2. es-ES
  3. fr-FR
  ...
Select language (1-10) or enter custom language code [1]: 1

🎤 Audio Input Selection
1. Microphone (real-time)
2. Audio file
Choose option (1-2) [1]: 1

🔧 Initializing Google Speech client...
✅ Google Speech client initialized successfully

🎤 Starting microphone test...
🎤 Microphone ready. Start speaking...

[14:30:15] 🔄 INTERIM (0.85): Hello world
[14:30:16] ✅ FINAL (0.92): Hello world, this is a test
```

## Environment Variables

You can set the following environment variables:

```bash
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"
```

## Troubleshooting

### Common Issues

1. **PyAudio Installation Error (macOS)**

   ```bash
   brew install portaudio
   pip install pyaudio
   ```

2. **Permission Denied Error**

   - Ensure your Google service account has Speech-to-Text API access
   - Check that the credentials file is readable

3. **Microphone Not Working**

   - Check microphone permissions in System Preferences
   - Try a different audio input device

4. **API Quota Exceeded**
   - Check your Google Cloud billing and quotas
   - Consider using a different project

### Debug Mode

For more verbose output, you can modify the script to add debug logging:

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

## File Structure

```
testing/
├── standalone_google_stt_test.py    # Main test application
├── requirements_standalone.txt      # Python dependencies
└── README_standalone.md            # This file
```

## Comparison with Vexa Implementation

This standalone test uses the same Google Speech-to-Text API configuration as the main Vexa project:

- **Sample Rate**: 16kHz
- **Encoding**: LINEAR16
- **Features**: Automatic punctuation, word time offsets
- **Streaming**: Real-time recognition with interim results

The main difference is that this test runs independently without the Vexa infrastructure (Redis, PostgreSQL, Docker, etc.).

## Next Steps

After verifying Google STT works with this test:

1. Test with different languages
2. Test with various audio files
3. Verify microphone quality and settings
4. Check confidence scores and accuracy
5. Proceed with full Vexa deployment if satisfied
