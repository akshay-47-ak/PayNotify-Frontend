let currentPaymentId = null;

const BASE_URL = "http://localhost:8080/api/payment";

async function generateQr() {

    const request = {
        merchantName: document.getElementById("merchantName").value,
        upiId: document.getElementById("upiId").value,
        amount: parseFloat(document.getElementById("amount").value),
        transactionRef: document.getElementById("transactionRef").value,
        note: document.getElementById("note").value
    };

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
        document.getElementById("paymentId").innerText = "Payment ID: " + currentPaymentId;

        document.getElementById("status").innerText = "Status: PENDING";

        startPolling();
    } else {
        alert("Error generating QR");
    }
}

async function sendNotification() {

    if (!currentPaymentId) {
        alert("Generate QR first!");
        return;
    }

    const request = {
        paymentId: currentPaymentId,
        packageName: "com.google.android.apps.nbu.paisa.user",
        title: "Payment received",
        message: document.getElementById("notificationMessage").value
    };

    const response = await fetch(BASE_URL + "/notify", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(request)
    });

    const data = await response.json();

    if (data.success) {
        alert("Notification sent!");
    } else {
        alert("Error sending notification");
    }
}

function startPolling() {

    const interval = setInterval(async () => {

        if (!currentPaymentId) return;

        const response = await fetch(BASE_URL + "/status/" + currentPaymentId);
        const data = await response.json();

        if (data.success && data.data) {
            const status = data.data.status;
            document.getElementById("status").innerText = "Status: " + status;

            if (status === "SUCCESS") {
                clearInterval(interval);
                alert("Payment Successful ✅");
            }
        }

    }, 3000);
}