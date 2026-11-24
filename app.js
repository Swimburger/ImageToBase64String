(() => {
    const COPY_FEEDBACK_MS = 2000;
    const LARGE_OUTPUT_BYTES = 100 * 1024;
    const OUTPUT_PREVIEW_CHARACTERS = 12_000;
    const MIME_EXTENSIONS = new Map([
        ["image/avif", "avif"],
        ["image/gif", "gif"],
        ["image/jpeg", "jpg"],
        ["image/png", "png"],
        ["image/svg+xml", "svg"],
        ["image/webp", "webp"],
    ]);

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
    const fileName = document.getElementById("file-name");
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
    let activeReadId = 0;
    let activeReader;

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

    function extensionForMime(mimeType) {
        if (MIME_EXTENSIONS.has(mimeType)) return MIME_EXTENSIONS.get(mimeType);
        const subtype = mimeType.startsWith("image/") ? mimeType.slice(6).split("+")[0] : "";
        return subtype.replace(/[^a-z0-9]/gi, "").slice(0, 10) || "img";
    }

    function safeFileName(file, { pasted = false } = {}) {
        const originalName = typeof file.name === "string" ? file.name : "";
        const leafName = originalName
            .split(/[\\/]/)
            .at(-1)
            .replace(/[\u0000-\u001f\u007f]/g, "")
            .trim()
            .slice(0, 120);
        if (leafName) return leafName;

        const prefix = pasted ? "pasted-image" : "unnamed-file";
        return `${prefix}.${extensionForMime(file.type || "")}`;
    }

    function normalizePastedImage(file, itemType = "") {
        const mime = file.type.startsWith("image/") ? file.type : itemType;
        const name = safeFileName({ name: file.name, type: mime }, { pasted: true });
        if (file.name === name && file.type === mime) return file;
        return new File([file], name, {
            type: mime,
            lastModified: file.lastModified || Date.now(),
        });
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

    function updateFileDetails(file, displayName) {
        const dataUrlBytes = new Blob([lastDataUrl]).size;
        const overhead = file.size > 0 ? ((dataUrlBytes / file.size) - 1) * 100 : 0;
        fileName.textContent = displayName;
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

    function processFile(file, { sample = false, source = "file" } = {}) {
        const readId = ++activeReadId;
        if (activeReader?.readyState === 1 && typeof activeReader.abort === "function") {
            activeReader.abort();
        }

        resetOutput();
        const isPasted = source === "paste";
        const displayName = sample ? "ramen.jpg" : safeFileName(file, { pasted: isPasted });
        setStatus(sample
            ? "Reading the sample image\u2026"
            : isPasted
                ? `Reading pasted image “${displayName}”…`
                : `Reading ${displayName}…`);

        const reader = new FileReader();
        activeReader = reader;
        const isCurrentRead = () => readId === activeReadId;
        const finishRead = () => {
            if (activeReader === reader) activeReader = undefined;
        };
        reader.onload = () => {
            if (!isCurrentRead()) return;
            finishRead();
            if (typeof reader.result !== "string" || !reader.result.startsWith("data:") || !reader.result.includes(",")) {
                setStatus("The file could not be converted to a valid data URL. Please try another file.", "error");
                return;
            }

            lastDataUrl = reader.result;
            lastFileSize = file.size;
            updateOutput();
            updateFileDetails(file, displayName);
            updateSnippets(file);
            copyButton.disabled = false;
            const label = sample ? "Sample image" : isPasted ? `Pasted image “${displayName}”` : displayName;
            setStatus(`${label} encoded successfully. The complete output is ready to copy.`);
        };
        reader.onerror = () => {
            if (!isCurrentRead()) return;
            finishRead();
            resetOutput();
            setStatus(isPasted
                ? "The pasted image could not be read. Copy it again and retry."
                : "The file could not be read. Please try another file.", "error");
        };
        reader.onabort = () => {
            if (!isCurrentRead()) return;
            finishRead();
            resetOutput();
            setStatus("Reading the file was cancelled. Please choose the file again.", "error");
        };

        try {
            reader.readAsDataURL(file);
        } catch {
            if (!isCurrentRead()) return;
            finishRead();
            resetOutput();
            setStatus(isPasted
                ? "The pasted image could not be read. Copy it again and retry."
                : "The file could not be read. Please try another file.", "error");
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
        const clipboardData = event.clipboardData;
        if (!clipboardData) return;

        const imageItem = [...clipboardData.items]
            .find((item) => item.kind === "file" && item.type.startsWith("image/"));
        const clipboardFile = imageItem?.getAsFile()
            || [...clipboardData.files].find((file) => file.type.startsWith("image/"));
        if (!imageItem && !clipboardFile) return;

        event.preventDefault();
        if (!clipboardFile) {
            setStatus("The pasted image could not be read. Copy it again and retry.", "error");
            return;
        }

        const pastedImage = normalizePastedImage(clipboardFile, imageItem?.type);
        processFile(pastedImage, { source: "paste" });
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

    const sampleRequestReadId = activeReadId;
    fetch("/ramen.jpg")
        .then((response) => {
            if (!response.ok) throw new Error("Sample image request failed");
            return response.blob();
        })
        .then((blob) => {
            if (activeReadId === sampleRequestReadId) processFile(blob, { sample: true });
        })
        .catch(() => {
            if (activeReadId !== sampleRequestReadId) return;
            resetOutput();
            setStatus("The sample image could not be loaded. Choose a file to begin.", "error");
        });
})();
