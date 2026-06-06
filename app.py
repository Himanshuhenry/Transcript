"""
TranscriptAI - Production-Ready Transcription Application
A Flask-based web application for audio transcription using Faster-Whisper
"""

from flask import Flask, render_template, request, jsonify, send_file, session
from flask_cors import CORS
from faster_whisper import WhisperModel
import os
import io
import json
import threading
import time
from datetime import datetime
from pathlib import Path
import uuid

# Initialize Flask app
app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'your-secret-key-change-in-production')
CORS(app)

# Configuration
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'mp3', 'mp4', 'wav', 'm4a', 'mov', 'flac', 'aac'}
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB
TRANSCRIPTION_TIMEOUT = 3600  # 1 hour

# Create upload folder if it doesn't exist
Path(UPLOAD_FOLDER).mkdir(exist_ok=True)

# Global state management for transcriptions
transcription_state = {}
state_lock = threading.Lock()

# Load Whisper model (cached after first load)
print("🚀 Loading Faster-Whisper model (base)...")
try:
    whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8")
    print("✅ Model loaded successfully")
except Exception as e:
    print(f"❌ Error loading model: {e}")
    whisper_model = None


def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_file_size_mb(file_size):
    """Convert bytes to MB"""
    return round(file_size / (1024 * 1024), 2)


def generate_session_id():
    """Generate unique session ID"""
    return str(uuid.uuid4())


def get_transcription_state(session_id):
    """Get transcription state with thread safety"""
    with state_lock:
        return transcription_state.get(session_id, {
            'status': 'ready',
            'progress': 0,
            'transcript': [],
            'filename': '',
            'duration': 0,
            'started_at': None,
            'completed_at': None
        })


def set_transcription_state(session_id, state):
    """Set transcription state with thread safety"""
    with state_lock:
        transcription_state[session_id] = state


def format_timestamp(seconds):
    """Convert seconds to HH:MM:SS format"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def format_timestamp_vtt(seconds):
    """Convert seconds to HH:MM:SS.mmm format for VTT"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def generate_srt(transcript_segments):
    """Generate SRT subtitle format"""
    srt_content = ""
    for index, segment in enumerate(transcript_segments, 1):
        start = format_timestamp(segment['start'])
        end = format_timestamp(segment['end'])
        text = segment['text'].strip()
        srt_content += f"{index}\n{start} --> {end}\n{text}\n\n"
    return srt_content


def generate_vtt(transcript_segments):
    """Generate VTT subtitle format"""
    vtt_content = "WEBVTT\n\n"
    for segment in transcript_segments:
        start = format_timestamp_vtt(segment['start'])
        end = format_timestamp_vtt(segment['end'])
        text = segment['text'].strip()
        vtt_content += f"{start} --> {end}\n{text}\n\n"
    return vtt_content


def generate_txt(transcript_segments):
    """Generate plain text format with timestamps"""
    txt_content = "TRANSCRIPT\n"
    txt_content += "=" * 50 + "\n\n"
    
    for segment in transcript_segments:
        start = f"{segment['start']:.2f}"
        end = f"{segment['end']:.2f}"
        text = segment['text'].strip()
        txt_content += f"[{start}s → {end}s]\n{text}\n\n"
    
    return txt_content


def transcribe_audio(session_id, file_path):
    """
    Perform transcription in background thread
    Updates state in real-time
    """
    state = get_transcription_state(session_id)
    state['status'] = 'transcribing'
    state['started_at'] = datetime.now().isoformat()
    set_transcription_state(session_id, state)
    
    try:
        if whisper_model is None:
            raise Exception("Whisper model failed to load")
        
        # Transcribe audio
        segments, info = whisper_model.transcribe(
            file_path,
            beam_size=5,
            language="en"
        )
        
        # Process segments
        transcript_segments = []
        segment_count = 0
        
        for segment in segments:
            segment_dict = {
                'start': segment.start,
                'end': segment.end,
                'text': segment.text.strip()
            }
            transcript_segments.append(segment_dict)
            segment_count += 1
            
            # Update state periodically
            if segment_count % 5 == 0:
                state = get_transcription_state(session_id)
                state['transcript'] = transcript_segments
                state['progress'] = min(90, int(segment_count * 2))
                set_transcription_state(session_id, state)
        
        # Mark as completed
        state = get_transcription_state(session_id)
        state['status'] = 'completed'
        state['progress'] = 100
        state['transcript'] = transcript_segments
        state['completed_at'] = datetime.now().isoformat()
        set_transcription_state(session_id, state)
        
        print(f"✅ Transcription completed for session {session_id}")
        
    except Exception as e:
        print(f"❌ Transcription error: {str(e)}")
        state = get_transcription_state(session_id)
        state['status'] = 'error'
        state['error'] = str(e)
        set_transcription_state(session_id, state)
    
    finally:
        # Clean up uploaded file
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception as e:
            print(f"⚠️ Error cleaning up file: {e}")


# ==================== API ROUTES ====================

@app.route('/')
def index():
    """Serve main page"""
    return render_template('index.html')


@app.route('/api/upload', methods=['POST'])
def upload_file():
    """
    Handle file upload and initiate transcription
    Returns session_id for tracking progress
    """
    try:
        # Validate request
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not allowed_file(file.filename):
            return jsonify({
                'error': f'File type not supported. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'
            }), 400
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > MAX_FILE_SIZE:
            return jsonify({
                'error': f'File too large. Maximum size: 500MB'
            }), 400
        
        # Generate session ID and save file
        session_id = generate_session_id()
        file_ext = file.filename.rsplit('.', 1)[1].lower()
        temp_filename = f"{session_id}.{file_ext}"
        file_path = os.path.join(UPLOAD_FOLDER, temp_filename)
        
        file.save(file_path)
        
        # Initialize transcription state
        initial_state = {
            'status': 'uploading',
            'progress': 0,
            'transcript': [],
            'filename': file.filename,
            'file_size': get_file_size_mb(file_size),
            'duration': 0,
            'started_at': None,
            'completed_at': None
        }
        set_transcription_state(session_id, initial_state)
        
        # Start transcription in background thread
        thread = threading.Thread(
            target=transcribe_audio,
            args=(session_id, file_path),
            daemon=True
        )
        thread.start()
        
        return jsonify({
            'session_id': session_id,
            'message': 'File uploaded, transcription started'
        }), 200
    
    except Exception as e:
        print(f"❌ Upload error: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/status/<session_id>', methods=['GET'])
def get_status(session_id):
    """Get transcription status and progress"""
    try:
        state = get_transcription_state(session_id)
        
        # Calculate elapsed time
        elapsed_time = 0
        if state.get('started_at'):
            start_dt = datetime.fromisoformat(state['started_at'])
            elapsed_time = (datetime.now() - start_dt).total_seconds()
        
        return jsonify({
            'status': state['status'],
            'progress': state['progress'],
            'transcript': state['transcript'],
            'filename': state['filename'],
            'file_size': state.get('file_size', 0),
            'elapsed_time': round(elapsed_time, 1),
            'error': state.get('error', None)
        }), 200
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/download/<session_id>/<format_type>', methods=['GET'])
def download_transcript(session_id, format_type):
    """Download transcript in specified format (txt, srt, vtt)"""
    try:
        state = get_transcription_state(session_id)
        
        if state['status'] != 'completed':
            return jsonify({'error': 'Transcription not completed'}), 400
        
        transcript_segments = state['transcript']
        
        if not transcript_segments:
            return jsonify({'error': 'No transcript data available'}), 400
        
        # Generate content based on format
        if format_type == 'txt':
            content = generate_txt(transcript_segments)
            filename = f"transcript.txt"
            mimetype = "text/plain"
        elif format_type == 'srt':
            content = generate_srt(transcript_segments)
            filename = f"transcript.srt"
            mimetype = "text/plain"
        elif format_type == 'vtt':
            content = generate_vtt(transcript_segments)
            filename = f"transcript.vtt"
            mimetype = "text/vtt"
        else:
            return jsonify({'error': 'Invalid format type'}), 400
        
        # Return file
        return send_file(
            io.BytesIO(content.encode('utf-8')),
            mimetype=mimetype,
            as_attachment=True,
            download_name=filename
        )
    
    except Exception as e:
        print(f"❌ Download error: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'model_loaded': whisper_model is not None,
        'timestamp': datetime.now().isoformat()
    }), 200


# ==================== ERROR HANDLERS ====================

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    # Development mode
    app.run(
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 5000)),
        debug=os.environ.get('FLASK_ENV') == 'development'
    )
