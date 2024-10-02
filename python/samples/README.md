# README

## Introduction

This repository contains sample code demonstrating the use of a custom client designed to ease the use of a real-time API. There are two main samples included:

1. `low_level_sample.py` - This file exercises a `LowLevelClient` to interact with the API.
2. `client_sample.py` - This file demonstrates the use of a higher-level `RTClient` which is a work in progress. The `RTClient` is intended as a convenience layer with abstractions that simplify the consumption of the API.

## Setup Instructions

### 1. Create and Activate a Virtual Environment

To ensure that dependencies are managed properly, it is recommended to use a virtual environment. Follow the steps below to set up and activate a virtual environment:

```sh
# Create a virtual environment
python3 -m venv venv

# Activate the virtual environment
source venv/bin/activate
```

### 2. Install Dependencies

Once the virtual environment is activated, download the latest package wheels and install the required dependencies using `pip`:

#### Windows

```pwsh
pwsh .\download-wheel.ps1
```
#### Linux / MacOS

```bash
./download-wheel.sh
```

Next, install the dependencies:
```sh
pip install -r requirements.txt
pip install rtclient-0.4.0-py3-none-any.whl
```

### 3. Set Up Environment Variables

The application requires certain environment variables to be set. These variables can be defined in a `.env` file. A template file named `development.env` is included in the repository. Follow the steps below to set up your `.env` file:

1. Copy the `development.env` template to a new file named `.env`:

    ```sh
    cp development.env .env
    ```

2. Open the `.env` file in a text editor and fill in the required values. The template provides placeholders for the necessary environment variables.

### 4. Running the Samples

- To run the low-level client sample:

    ```sh
    python low_level_sample.py <audio file> <azure|openai>
    ```

    Where the `<audio file>` is the input audio to be used in the run (sample files in the supported formats are included in the repository).

    The last parameter can be iether `azure` or `openai` depending if the sample is to be run against Azure OpenAI or OpenAI respectively.

- To run the high-level client sample:

    ```sh
    python client_sample.py <audio_file> <out_dir> <azure|openai>
    ```

    Where the parameters are the same as the ones for `low_level_client.py` with the addition of `<out_dir>`, which is an existing directory where all the output of the run is to be stored.

## Notes

- The `RTClient` is a work in progress and is intended to provide a higher level of abstraction to simplify the consumption of the API.
- Ensure that the `.env` file is correctly filled with the necessary credentials and configuration settings before running the samples.
