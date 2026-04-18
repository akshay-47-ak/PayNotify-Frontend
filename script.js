let currentPaymentId = null;
let stompClient = null;
let currentSubscription = null;
let fallbackTimeout = null;
let isSocketConnected = false;

const BASE_URL = "http://localhost:8080/api/payment";
const WS_URL = "http://localhost:8080/ws";

async function generateQr() {
    resetUiForNewPayment();
    unsubscribeCurrentPayment();

    const request = {
        merchantName: document.getElementById("merchantName").value,
        upiId: document.getElementById("upiId").value,
        amount: parseFloat(document.getElementById("amount").value)
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

        if (data.success && data.data) {
            const qrBase64 = data.data.qrImageBase64;

            document.getElementById("qrImage").src = "data:image/png;base64," + qrBase64;

            currentPaymentId = data.data.paymentId;

            document.getElementById("paymentId").innerText =
                "Payment ID: " + currentPaymentId;

            document.getElementById("transactionRef").innerText =
                "Transaction Ref: " + (data.data.transactionRef || "");

            document.getElementById("status").innerText = "Status: WAITING_FOR_PAYMENT";

            connectWebSocketAndSubscribe(currentPaymentId);
            startFallbackStatusCheck();
        } else {
            alert("Error generating QR");
        }
    } catch (e) {
        console.error("Generate QR error:", e);
        alert("Failed to generate QR");
    }
}

function connectWebSocketAndSubscribe(paymentId) {
    if (!paymentId) {
        return;
    }

    if (stompClient && isSocketConnected) {
        subscribeToPaymentTopic(paymentId);
        return;
    }

    const socket = new SockJS(WS_URL);
    stompClient = Stomp.over(socket);
    stompClient.debug = null;

    updateSocketStatus("CONNECTING");

    stompClient.connect(
        {},
        function () {
            isSocketConnected = true;
            updateSocketStatus("CONNECTED");
            subscribeToPaymentTopic(paymentId);
        },
        function (error) {
            console.error("WebSocket connection error:", error);
            isSocketConnected = false;
            updateSocketStatus("ERROR");
        }
    );
}

function subscribeToPaymentTopic(paymentId) {
    if (!stompClient || !isSocketConnected) {
        return;
    }

    unsubscribeCurrentPayment();

    const destination = "/topic/payment/" + paymentId;

    currentSubscription = stompClient.subscribe(destination, function (message) {
        try {
            const event = JSON.parse(message.body || "{}");
            handlePaymentEvent(event);
        } catch (e) {
            console.error("Failed to parse WebSocket event:", e);
        }
    });

    updateSocketStatus("CONNECTED");
    console.log("Subscribed to:", destination);
}

function handlePaymentEvent(event) {
    if (!event || !event.paymentId) {
        return;
    }

    if (currentPaymentId !== event.paymentId) {
        return;
    }

    const status = (event.status || "UNKNOWN").toString();
    document.getElementById("status").innerText = "Status: " + status;

    if (status === "SUCCESS") {
        clearFallbackStatusCheck();
        unsubscribeCurrentPayment();
        alert("Payment Successful ✅");
    } else if (status === "FAILED" || status === "PENDING_REVIEW" || status === "EXPIRED") {
        clearFallbackStatusCheck();
        unsubscribeCurrentPayment();
    }
}

function unsubscribeCurrentPayment() {
    if (currentSubscription) {
        try {
            currentSubscription.unsubscribe();
        } catch (e) {
            console.error("Unsubscribe error:", e);
        }
        currentSubscription = null;
    }
}

function disconnectWebSocket() {
    unsubscribeCurrentPayment();

    if (stompClient) {
        try {
            stompClient.disconnect(() => {
                isSocketConnected = false;
                updateSocketStatus("DISCONNECTED");
            });
        } catch (e) {
            console.error("Disconnect error:", e);
            isSocketConnected = false;
            updateSocketStatus("DISCONNECTED");
        }
        stompClient = null;
    } else {
        isSocketConnected = false;
        updateSocketStatus("DISCONNECTED");
    }
}

function updateSocketStatus(status) {
    document.getElementById("socketStatus").innerText = "WebSocket: " + status;
}

function resetUiForNewPayment() {
    clearFallbackStatusCheck();
    document.getElementById("status").innerText = "Status: PENDING";
    document.getElementById("paymentId").innerText = "";
    document.getElementById("transactionRef").innerText = "";
    document.getElementById("qrImage").src = "";

    if (isSocketConnected) {
        updateSocketStatus("CONNECTED");
    } else {
        updateSocketStatus("DISCONNECTED");
    }
}

function startFallbackStatusCheck() {
    clearFallbackStatusCheck();

    fallbackTimeout = setTimeout(async () => {
        if (!currentPaymentId) {
            return;
        }

        try {
            const response = await fetch(BASE_URL + "/status/" + currentPaymentId);
            const data = await response.json();

            if (data.success && data.data) {
                const status = data.data.status;
                document.getElementById("status").innerText = "Status: " + status;

                if (status === "SUCCESS") {
                    unsubscribeCurrentPayment();
                    alert("Payment Successful ✅");
                }
            }
        } catch (e) {
            console.error("Fallback status check error:", e);
        }
    }, 15000);
}

function clearFallbackStatusCheck() {
    if (fallbackTimeout) {
        clearTimeout(fallbackTimeout);
        fallbackTimeout = null;
    }
}

window.addEventListener("beforeunload", function () {
    disconnectWebSocket();
});