// Register native system event tracking listeners for the drag-and-drop mechanics
document.addEventListener("DOMContentLoaded", () => {
    const dropZone = document.getElementById("dropZone");
    const fileInput = document.getElementById("fileUpload");

    if (dropZone) {
        // Prevent default browser file behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => e.preventDefault(), false);
        });

        // Add focus visual borders on active drag entry
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
        });

        // Remove active visual styling on leave
        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
        });

        // Handle direct drop injection vector
        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files.length) {
                fileInput.files = files;
                handleFileSelection(fileInput);
            }
        });
    }
});

// Update the label badge smoothly when a profile is loaded
function handleFileSelection(input) {
    const textNode = document.getElementById('fileNameTxt');
    if (input.files && input.files[0]) {
        textNode.innerText = `Selected: ${input.files[0].name}`;
        textNode.style.display = "inline-block";
    } else {
        textNode.innerText = "";
        textNode.style.display = "none";
    }
}

// Core PDF Text Extraction & Model Pipeline Processing
async function processUploadedFile() {
    const fileInput = document.getElementById("fileUpload");
    const file = fileInput.files[0];
    const btn = document.getElementById("processBtn");
    const resultBox = document.getElementById("resultBox");

    if (!file) { alert("Please attach a document file target first."); return; }
    
    btn.innerText = "Extracting Document Vectors...";
    btn.disabled = true;
    resultBox.classList.add("hidden");

    try {
        const fileArrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: fileArrayBuffer }).promise;
        let extractedPlaintext = "";

        for (let i = 1; i <= pdfDoc.numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const content = await page.getTextContent();
            const pageStrings = content.items.map(item => item.str);
            extractedPlaintext += pageStrings.join(" ") + " ";
        }

        if (!extractedPlaintext.trim()) {
            throw new Error("Unable to extract valid text strings.");
        }

        btn.innerText = "Querying Inference Layer...";

        // Dynamic context fallback for working email address parameters
        const userEmail = (window.currentUser && window.currentUser.email) ? window.currentUser.email : "audit_clerk@enterprise.internal";

        const response = await fetch("/api/v1/verify-resume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                resume_text: extractedPlaintext,
                user_email: userEmail
            })
        });

        if (!response.ok) throw new Error("Backend offline or validation barrier encountered.");

        const data = await response.json();
        
        // Target dynamic layout metrics paths
        const banner = document.getElementById("verdictBanner");
        const icon = document.getElementById("verdictIcon");
        const title = document.getElementById("verdictTitle");
        const confMetric = document.getElementById("metricConfidence");
        const skillsMetric = document.getElementById("metricSkillsCount");
        const tagsContainer = document.getElementById("skillsTagsContainer");

        // Format clean metric tags
        resultBox.classList.remove("hidden", "suspicious", "genuine");
        tagsContainer.innerHTML = ""; // Wipe older loops

        if (data.prediction === 1) {
            resultBox.classList.add("suspicious");
            icon.innerText = "⚠️";
            title.innerText = `Verdict: ${data.verdict}`;
        } else {
            resultBox.classList.add("genuine");
            icon.innerText = "✅";
            title.innerText = `Verdict: ${data.verdict}`;
        }

        // Apply raw analytic updates
        confMetric.innerText = `${data.confidence_percentage.toFixed(2)}%`;
        skillsMetric.innerText = data.analytics.detected_skills_count;

        // Populate skill tokens loops safely
        if(data.analytics.detected_skills_list && data.analytics.detected_skills_list.length > 0) {
            data.analytics.detected_skills_list.forEach(skill => {
                const span = document.createElement("span");
                span.className = "skill-tag";
                span.innerText = skill.toUpperCase();
                tagsContainer.appendChild(span);
            });
        } else {
            tagsContainer.innerHTML = `<span style="font-size:12px; color:var(--text-muted); font-style:italic;">No tech signatures traced.</span>`;
        }

    } catch (err) {
        alert("System Processing Error encountered: " + err.message);
    } finally {
        btn.innerText = "Process Application Profile";
        btn.disabled = false;
    }
}