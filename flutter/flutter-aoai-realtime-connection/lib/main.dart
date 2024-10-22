import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_sound/flutter_sound.dart';
import 'package:flutter_sound_platform_interface/flutter_sound_recorder_platform_interface.dart'
  as flutter_sound;
import 'package:path_provider/path_provider.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'dart:io';
import 'dart:typed_data';
import 'dart:convert';
import 'package:audioplayers/audioplayers.dart';
// import permission handler
import 'package:permission_handler/permission_handler.dart';

void main() {
  runApp(MyApp());
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
  return MaterialApp(
    home: AudioRecorder(),
  );
  }
}

class AudioRecorder extends StatefulWidget {
  @override
  _AudioRecorderState createState() => _AudioRecorderState();
}

class _AudioRecorderState extends State<AudioRecorder> {
  FlutterSoundRecorder _recorder = FlutterSoundRecorder();
  AudioPlayer _audioPlayer = AudioPlayer();
  FlutterSoundPlayer soundPlayerx = FlutterSoundPlayer();
  final List<Uint8List> audioBuffer = []; // Buffer to hold audio data
  int bufferSize = 1024 * 5; // Example buffer size (5KB)
  bool _isRecording = false;
  bool _isSessionActive = false;
  late WebSocketChannel _channel;
  late String event_id;
  late Map<String, dynamic> session_id;
  Timer? _silenceTimer;
  final List<Uint8List> _receivedAudioData =
    []; // List to store received audio data

  @override
  void initState() {
  super.initState();
  _requestPermissions();
  }

  Future<void> _requestPermissions() async {
  var status = await Permission.microphone.request();
  if (status.isGranted) {
    await _recorder.openRecorder();
    await soundPlayerx.openPlayer();
    _startSession();
  } else {
    // Handle the case when permission is not granted
    print('Microphone permission not granted');
  }

  var storageStatus = await Permission.storage.request();
  if (!storageStatus.isGranted) {
    // Handle the case when storage permission is not granted
    print('Storage permission not granted');
  }
  }

  @override
  void dispose() {
  _recorder.closeRecorder();
  _audioPlayer.dispose();
  if (_isSessionActive) {
    _channel.sink.close();
  }
  _silenceTimer?.cancel();
  super.dispose();
  }

  bool _isBufferReady() {
  // Check if the total size of audioBuffer exceeds bufferSize
  int totalSize = audioBuffer.fold(0, (sum, item) => sum + item.length);
  return totalSize >= bufferSize;
  }

  Uint8List _combineBuffer() {
  // Combine all Uint8Lists in audioBuffer into one
  return Uint8List.fromList(audioBuffer.expand((x) => x).toList());
  }

  void onAudioReceived(Uint8List audioBytes) {
  // Add the new audio bytes to the buffer
  audioBuffer.add(audioBytes);

  // Check if we have enough data to play
  if (_isBufferReady()) {
    // Combine buffered audio data into a single Uint8List
    final Uint8List combinedAudio = _combineBuffer();
    // Start playback
    _playAudioStream(combinedAudio);
    // Clear the buffer after playing
    audioBuffer.clear();
  }
  }

  void _startSession() {
  _channel = IOWebSocketChannel.connect(
    'wss://<endpoint-url>/openai/realtime?api-version=2024-10-01-preview&deployment=<deployment-name>&api-key=<api-key>');
  _channel.stream.listen((message) async {
    print('Received from server: $message');
    Map<String, dynamic> jsonMessage = jsonDecode(message);
    setState(() {
    event_id = jsonMessage['event_id'];
    });
    if (jsonMessage.containsKey('delta')) {
    if (jsonMessage['type'] == "response.audio.delta") {
      Uint8List decodedBytes = base64Decode(jsonMessage['delta']);
      print(decodedBytes);

      _receivedAudioData.add(decodedBytes); // Collect the audio data
    }
    }
    if (jsonMessage['type'] == "response.done") {
        await Future.delayed(Duration(seconds: 3));
      _playCollectedAudio(); // Play the collected audio data
    }
  });
  setState(() {
    _isSessionActive = true;
  });
  print('Connected to server');
  }

  void _stopSession() {
  _channel.sink.close();
  setState(() {
    _isSessionActive = false;
  });
  print('Disconnected from server');
  _playCollectedAudio(); // Play the collected audio data
  }

  Future<void> _startRecording() async {
  Directory tempDir = await getTemporaryDirectory();
  String tempPath = '${tempDir.path}/temp_audio.pcm';

  await _recorder.startRecorder(
    codec: Codec.pcm16,
    toFile: tempPath,
    audioSource: flutter_sound.AudioSource.microphone,
  );
  setState(() {
    _isRecording = true;
  });
  _monitorAudioLevel();
  }

  Future<void> _stopRecording() async {
  String? path = await _recorder.stopRecorder();
  if (path != null) {
    File audioFile = File(path);
    Uint8List audioBytes = await audioFile.readAsBytes();
    _sendAudioToServer(audioBytes);
  }
  setState(() {
    _isRecording = false;
  });
  }

  void _sendAudioToServer(Uint8List audioBytes) {
  print(event_id);
  String base64Audio = base64Encode(audioBytes);
  _channel.sink.add(jsonEncode({
    'type': 'input_audio_buffer.append',
    'audio': base64Audio,
    'event_id': event_id,
  }));
  _channel.sink.add(jsonEncode({
    'type': 'response.create',
    'event_id': event_id,
  }));
  print('Audio file sent successfully');
  }

  Future<void> _playAudioStream(Uint8List audioBytes) async {
  try {
    print('Received audio stream length: ${audioBytes.length} bytes');

    if (audioBytes.isNotEmpty) {
    await soundPlayerx.startPlayer(
      fromDataBuffer: audioBytes,
      codec: Codec.pcm16, // Ensure this matches your audio format
      numChannels: 1, // Mono audio
      sampleRate:
        24000, // Ensure this matches the original audio's sample rate
      whenFinished: () => print('Finished playing audio stream'),
    );

    print('Playing received audio stream');
    } else {
    print('Audio data is empty');
    }
  } catch (e) {
    print('Error playing audio stream: $e');
  }
  }

  Future<void> _playCollectedAudio() async {
  if (_receivedAudioData.isNotEmpty) {
    Uint8List combinedAudio =
      Uint8List.fromList(_receivedAudioData.expand((x) => x).toList());
    await _playAudioStream(combinedAudio);
    _receivedAudioData
      .clear(); // Clear the collected audio data after playing
  }
  }

  void _monitorAudioLevel() {
  _recorder.onProgress!.listen((event) {
    double amplitude = event.decibels ?? 0.0;
    print("amplitude=> $amplitude");
    if (amplitude > -10) {
    _silenceTimer?.cancel();
    } else {
    _silenceTimer ??= Timer(Duration(seconds: 2), () {
      _stopRecording();
    });
    }
  });
  }

  @override
  Widget build(BuildContext context) {
  return Scaffold(
    appBar: AppBar(
    title: Text('Audio Recorder'),
    ),
    body: Center(
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
      ElevatedButton(
        onPressed: _isSessionActive ? null : _startSession,
        child: Text('Start Session'),
      ),
      ElevatedButton(
        onPressed: _isSessionActive ? _stopSession : null,
        child: Text('Stop Session'),
      ),
      ElevatedButton(
        onPressed: _isRecording ? null : _startRecording,
        child: Text('Start Recording'),
      ),
      ElevatedButton(
        onPressed: _isRecording ? _stopRecording : null,
        child: Text('Stop Recording'),
      ),
      ],
    ),
    ),
  );
  }
}
