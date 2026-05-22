async function processUploadedFile() {
    const fileInput = document.getElementById("fileUpload");
    const file = fileInput.files[0];
    const btn = document.getElementById("processBtn");
    const resultBox = document.getElementById("resultBox");

    if (!file) { alert("Please attach a document file target first."); return; }
    
    btn.innerText = "Executing PDF OCR Text Extraction...";
    btn.disabled = true;

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

        btn.innerText = "Querying Random Forest Inference Layer...";

        const response = await fetch("/api/v1/verify-resume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                resume_text: extractedPlaintext,
                user_email: window.currentUser.email
            })
        });

        const data = await response.json();
        resultBox.classList.remove("hidden", "suspicious", "genuine");
        resultBox.style.display = "block";
        
        if (data.prediction === 1) {
            resultBox.className = "result-box suspicious";
            resultBox.innerText = `⚠️ Verdict: ${data.verdict} (${data.confidence_percentage}% Confidence)\nDetected Tech Core Skills: ${data.analytics.detected_skills_list.join(", ") || 'None'}`;
        } else {
            resultBox.className = "result-box genuine";
            resultBox.innerText = `✅ Verdict: ${data.verdict} (${data.confidence_percentage}% Confidence)\nSkills Found: ${data.analytics.detected_skills_list.join(", ") || 'None'}`;
        }

    } catch (err) {
        alert("System Processing Error encountered: " + err.message);
    } finally {
        btn.innerText = "Process Application Profile";
        btn.disabled = false;
    }
}