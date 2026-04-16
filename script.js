let currentPaymentId = null;
let pollingInterval = null;
let pollingCount = 0;
const MAX_POLL_COUNT = 40; // 40 * 3 sec = 120 sec

const BASE_URL = "http://localhost:8080/api/payment";

async function generateQr() {
    const request = {
        merchantName: document.getElementById("merchantName").value,
        upiId: document.getElementById("upiId").value,
        amount: parseFloat(document.getElementById("amount").value),
        transactionRef: document.getElementById("transactionRef").value,
        note: document.getElementById("note").value
    };

    try {
        const response = await fetch(BASE_URL + "/qr/generate", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(request)
        });

        const data = await response.json();

        if (data.success) {
            const qrBase64 = data.data.qrImageBase64;

            document.getElementById("qrImage").src = "data:image/png;base64," + qrBase64;

            currentPaymentId = data.data.paymentId;
           document.getElementById("paymentId").innerText =
           "Payment ID: " + currentPaymentId + " | Transaction Ref: " + data.data.transactionRef;
            document.getElementById("status").innerText = "Status: WAITING_FOR_PAYMENT";

            startPolling();
        } else {
            alert("Error generating QR");
        }
    } catch (e) {
        console.error("Generate QR error:", e);
        alert("Failed to generate QR");
    }
}

function startPolling() {
    stopPolling();
    pollingCount = 0;

    pollingInterval = setInterval(async () => {
        if (!currentPaymentId) {
            stopPolling();
            return;
        }

        pollingCount++;

        if (pollingCount > MAX_POLL_COUNT) {
            document.getElementById("status").innerText = "Status: TIMEOUT";
            stopPolling();
            return;
        }

        try {
            const response = await fetch(BASE_URL + "/status/" + currentPaymentId);
            const data = await response.json();

            if (data.success && data.data) {
                const status = data.data.status;
                document.getElementById("status").innerText = "Status: " + status;

                if (status === "SUCCESS") {
                    stopPolling();
                    alert("Payment Successful ✅");
                } else if (status === "FAILED" || status === "PENDING_REVIEW") {
                    stopPolling();
                }
            } else {
                stopPolling();
                document.getElementById("status").innerText = "Status: ERROR";
            }
        } catch (e) {
            console.error("Polling error:", e);
            stopPolling();
            document.getElementById("status").innerText = "Status: ERROR";
        }
    }, 3000);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}