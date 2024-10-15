$Owner = "Azure-Samples"
$Repo = "aoai-realtime-audio-sdk"
$Filter = "-py3-none-any.whl"
$Release = "py/v0.5.1"
$OutputDir = "."

$apiUrl = "https://api.github.com/repos/$Owner/$Repo/releases/tags/$Release"

$release = Invoke-RestMethod -Uri $apiUrl -Headers @{"Accept"="application/vnd.github.v3+json"}

$matchingAssets = $release.assets | Where-Object { $_.name -like "*$Filter*" }

if ($matchingAssets.Count -eq 0) {
    Write-Host "No assets found matching the filter: $Filter"
    exit
}

foreach ($asset in $matchingAssets) {
    $assetName = $asset.name
    $downloadUrl = $asset.browser_download_url
    $outputPath = Join-Path $OutputDir $assetName

    Write-Host "Downloading $assetName..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $outputPath
    Write-Host "Downloaded $assetName to $outputPath"
}

Write-Host "All artifacts downloaded successfully."