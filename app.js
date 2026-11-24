(() => {
    const COPY_FEEDBACK_MS = 2000;
    const LARGE_OUTPUT_BYTES = 100 * 1024;
    const OUTPUT_PREVIEW_CHARACTERS = 12_000;

    const fileInput = document.getElementById("file-input");
    const dropZone = document.getElementById("drop-zone");
    const outputImage = document.getElementById("output-image");
    const previewPlaceholder = document.getElementById("preview-placeholder");
    const outputText = document.getElementById("output-text");
    const outputPreviewNote = document.getElementById("output-preview-note");
    const copyButton = document.getElementById("copy-button");
    const copyLabel = document.getElementById("copy-label");
    const clipboardIcon = document.getElementById("clipboard-icon");
    const appStatus = document.getElementById("app-status");
    const fileDetails = document.getElementById("file-details");
    const originalSize = document.getElementById("original-size");
    const encodedSize = document.getElementById("encoded-size");
    const sizeOverhead = document.getElementById("size-overhead");
    const mimeType = document.getElementById("mime-type");
    const snippetSection = document.getElementById("snippet-section");
    const snippetHtml = document.getElementById("snippet-html");
    const snippetCss = document.getElementById("snippet-css");
    const snippetMd = document.getElementById("snippet-md");

    let lastDataUrl = "";
    let lastFileSize = 0;
    let copyFeedbackTimer;

    function setStatus(message, tone = "success") {
        appStatus.textContent = message;
        appStatus.dataset.tone = tone;
    }

    function formatBytes(bytes) {
        if (bytes === 0) return "0 bytes";
        const units = ["bytes", "KB", "MB", "GB"];
        const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
        const value = bytes / 1024 ** unitIndex;
        const digits = unitIndex === 0 || value >= 10 ? 0 : 1;
        return `${value.toFixed(digits)} ${units[unitIndex]}`;
    }

    function getFormat() {
        return document.querySelector('input[name="format"]:checked').value;
    }

    function getFormattedOutput() {
        if (!lastDataUrl) return "";
        return getFormat() === "base64"
            ? lastDataUrl.slice(lastDataUrl.indexOf(",") + 1)
            : lastDataUrl;
    }

    function updateOutput() {
        const fullOutput = getFormattedOutput();
        if (!fullOutput) return;

        const shouldShorten = lastFileSize > LARGE_OUTPUT_BYTES
            && fullOutput.length > OUTPUT_PREVIEW_CHARACTERS;
        outputText.value = shouldShorten
            ? `${fullOutput.slice(0, OUTPUT_PREVIEW_CHARACTERS)}\n\n…`
            : fullOutput;
        outputText.toggleAttribute("data-truncated", shouldShorten);
        outputPreviewNote.hidden = !shouldShorten;
    }

    function resetOutput() {
        lastDataUrl = "";
        lastFileSize = 0;
        outputText.value = "";
        outputText.removeAttribute("data-truncated");
        outputPreviewNote.hidden = true;
        copyButton.disabled = true;
        fileDetails.hidden = true;
        snippetSection.hidden = true;
        outputImage.removeAttribute("src");
        outputImage.hidden = true;
        previewPlaceholder.hidden = false;
    }

    function updateFileDetails(file) {
        const dataUrlBytes = new Blob([lastDataUrl]).size;
        const overhead = file.size > 0 ? ((dataUrlBytes / file.size) - 1) * 100 : 0;
        originalSize.textContent = formatBytes(file.size);
        encodedSize.textContent = formatBytes(dataUrlBytes);
        sizeOverhead.textContent = file.size > 0 ? `+${overhead.toFixed(1)}%` : "Not applicable";
        mimeType.textContent = file.type || "Unknown";
        fileDetails.hidden = false;
    }

    function updateSnippets(file) {
        const isImage = file.type?.startsWith("image/");
        if (!isImage) return;

        outputImage.src = lastDataUrl;
        outputImage.hidden = false;
        previewPlaceholder.hidden = true;

        const isTruncated = lastDataUrl.length > 40;
        const preview = isTruncated ? `${lastDataUrl.slice(0, 40)}\u2026` : lastDataUrl;
        snippetHtml.value = `<img src="${preview}" alt="">`;
        snippetCss.value = `background-image: url("${preview}");`;
        snippetMd.value = `![alt](${preview})`;
        [snippetHtml, snippetCss, snippetMd].forEach((field) => {
            field.toggleAttribute("data-truncated", isTruncated);
        });
        snippetSection.hidden = false;
    }

    function processFile(file, { sample = false } = {}) {
        resetOutput();
        setStatus(sample ? "Reading the sample image\u2026" : `Reading ${file.name || "the selected file"}\u2026`);

        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result !== "string" || !reader.result.startsWith("data:") || !reader.result.includes(",")) {
                setStatus("The file could not be converted to a valid data URL. Please try another file.", "error");
                return;
            }

            lastDataUrl = reader.result;
            lastFileSize = file.size;
            updateOutput();
            updateFileDetails(file);
            updateSnippets(file);
            copyButton.disabled = false;
            const label = sample ? "Sample image" : (file.name || "File");
            setStatus(`${label} encoded successfully. The complete output is ready to copy.`);
        };
        reader.onerror = () => {
            resetOutput();
            setStatus("The file could not be read. Please try another file.", "error");
        };
        reader.onabort = () => {
            resetOutput();
            setStatus("Reading the file was cancelled. Please choose the file again.", "error");
        };

        try {
            reader.readAsDataURL(file);
        } catch {
            resetOutput();
            setStatus("The file could not be read. Please try another file.", "error");
        }
    }

    async function copyText(text, successMessage) {
        if (!text) {
            setStatus("There is no generated output to copy yet.", "error");
            return false;
        }

        try {
            await navigator.clipboard.writeText(text);
            setStatus(successMessage);
            return true;
        } catch {
            setStatus("Copying to the clipboard failed. Select the text and copy it manually.", "error");
            return false;
        }
    }

    fileInput.addEventListener("change", (event) => {
        const file = event.target.files[0];
        if (file) processFile(file);
    });

    dropZone.addEventListener("click", () => fileInput.click());
    dropZone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropZone.classList.add("drag-over");
    });
    dropZone.addEventListener("dragleave", (event) => {
        if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove("drag-over");
    });
    dropZone.addEventListener("drop", (event) => {
        event.preventDefault();
        dropZone.classList.remove("drag-over");
        const file = event.dataTransfer.files[0];
        if (file) processFile(file);
    });

    document.addEventListener("paste", (event) => {
        const file = [...event.clipboardData.items]
            .find((item) => item.kind === "file")
            ?.getAsFile();
        if (file) processFile(file);
    });

    document.querySelectorAll('input[name="format"]').forEach(
        (input) => input.addEventListener("change", updateOutput)
    );

    ["click", "focus"].forEach((eventName) => {
        outputText.addEventListener(eventName, () => outputText.setSelectionRange(0, outputText.value.length));
    });

    const snippetBuilders = {
        "snippet-html": () => `<img src="${lastDataUrl}" alt="">`,
        "snippet-css": () => `background-image: url("${lastDataUrl}");`,
        "snippet-md": () => `![alt](${lastDataUrl})`,
    };

    const truncatedFieldBuilders = new Map([
        [outputText, getFormattedOutput],
        [snippetHtml, snippetBuilders["snippet-html"]],
        [snippetCss, snippetBuilders["snippet-css"]],
        [snippetMd, snippetBuilders["snippet-md"]],
    ]);

    truncatedFieldBuilders.forEach((buildFullValue, field) => {
        field.addEventListener("copy", (event) => {
            if (!field.hasAttribute("data-truncated")) return;

            event.preventDefault();
            try {
                const fullValue = buildFullValue();
                if (!fullValue || !event.clipboardData) throw new Error("Clipboard data is unavailable");
                event.clipboardData.setData("text/plain", fullValue);
                setStatus("Copied the complete value from the shortened preview.");
            } catch {
                setStatus("Copying the complete value failed. Use the Copy button instead.", "error");
            }
        });
    });

    document.querySelectorAll(".snippet-copy").forEach((button) => {
        button.addEventListener("click", async () => {
            const format = button.dataset.target.replace("snippet-", "").replace("md", "Markdown").toUpperCase();
            const copied = await copyText(snippetBuilders[button.dataset.target](), `Copied the complete ${format} snippet.`);
            if (!copied) return;

            const original = button.textContent;
            button.textContent = "Copied!";
            window.setTimeout(() => { button.textContent = original; }, COPY_FEEDBACK_MS);
        });
    });

    copyButton.addEventListener("click", async () => {
        const copied = await copyText(getFormattedOutput(), "Copied the complete Base64 output.");
        if (!copied) return;

        window.clearTimeout(copyFeedbackTimer);
        copyLabel.textContent = "Copied!";
        clipboardIcon.hidden = true;
        copyFeedbackTimer = window.setTimeout(() => {
            copyLabel.textContent = "Copy";
            clipboardIcon.hidden = false;
        }, COPY_FEEDBACK_MS);
    });

    fetch("/ramen.jpg")
        .then((response) => {
            if (!response.ok) throw new Error("Sample image request failed");
            return response.blob();
        })
        .then((blob) => processFile(blob, { sample: true }))
        .catch(() => {
            resetOutput();
            setStatus("The sample image could not be loaded. Choose a file to begin.", "error");
        });
})();
