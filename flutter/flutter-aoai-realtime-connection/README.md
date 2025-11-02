# dart_aoai_rt_connection

A Flutter application for real-time audio recording, processing, and communication using WebSockets and OpenAI’s API.

## Getting Started

### Steps to Run the Application

1. **Clone the Repository**: Clone this repository to your local machine.

    ```bash
    git clone <repository-url>
    ```

2. **Install Dependencies**: Navigate to the project directory and run the following command to install the required dependencies.

    ```bash
    flutter pub get
    ```

3. **Configure Android Permissions**: Ensure that you have assigned the necessary permissions in the `AndroidManifest.xml` file for storage and microphone access. Add the following permissions if they are not already present:

    ```xml
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"/>
    <uses-permission android:name="android.permission.RECORD_AUDIO"/>
    ```

4. **Configure WebSocket URL**: In your Dart code, replace the placeholders in the WebSocket URL with the required variables such as the endpoint, deployment name, API key, and API version.

    ```dart
    _channel = IOWebSocketChannel.connect(
      'wss://<endpoint-url>/openai/realtime?api-version=2024-10-01-preview&deployment=<deployment-name>&api-key=<api-key>');
    ```

    - `<endpoint-url>`: Your WebSocket server endpoint.
    - `<deployment-name>`: The deployment name for the service.
    - `<api-key>`: Your API key.
    - `<api-version>`: The API version you are using.

5. **Run the Application**: Use the following command to run the Flutter app on your device or emulator.

    ```bash
    flutter run
    ```

6. **Using the Application**: After the application runs successfully, you will see a screen with buttons:
    - **Start Session**: Starts the WebSocket session for audio communication.
    - **Stop Session**: Ends the WebSocket session.
    - **Start Recording**: Begins recording audio from the microphone.
    - **Stop Recording**: Stops recording and sends the audio data to the server.

### Additional Resources

- [Flutter Documentation](https://docs.flutter.dev/)
- [Flutter Samples](https://docs.flutter.dev/cookbook)
- [OpenAI API Documentation](https://platform.openai.com/docs/)
  
For help getting started with Flutter development, view the [online documentation](https://docs.flutter.dev/), which offers tutorials, samples, and a full API reference.

