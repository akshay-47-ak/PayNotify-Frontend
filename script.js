let currentPaymentId = null;
let currentTerminalId = null;
let stompClient = null;
let currentSubscription = null;
let fallbackTimeout = null;
let isSocketConnected = false;

const ENTERPRISE_BASE_URL = "http://localhost:8080/api/enterprise";
const PAYMENT_BASE_URL = "http://localhost:8080/api/payment";
const WS_URL = "http://localhost:8080/ws";

async function createEnterprise() {
    const enterpriseCode = document.getElementById("enterpriseCode").value.trim();
    const enterpriseName = document.getElementById("enterpriseName").value.trim();
    const liveFrom = document.getElementById("liveFrom").value;

    if (!enterpriseCode || !enterpriseName) {
        alert("Please enter enterprise code and enterprise name");
        return;
    }

    const request = {
        enterpriseCode: enterpriseCode,
        enterpriseName: enterpriseName,
        liveFrom: liveFrom ? new Date(liveFrom).toISOString() : null
    };

    try {
        const response = await fetch(ENTERPRISE_BASE_URL + "/create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(request)
        });

        const data = await response.json();

        if (data.success && data.data) {
            document.getElementById("enterpriseResult").innerText =
                "Created: " + (data.data.enterpriseCode || enterpriseCode) +
                " | " + (data.data.enterpriseName || enterpriseName);

            document.getElementById("paymentEnterpriseCode").value =
                data.data.enterpriseCode || enterpriseCode;

            addLog("Enterprise created successfully: " + enterpriseCode);
        } else {
            alert(data.message || "Failed to create enterprise");
            addLog("Enterprise creation failed");
        }
    } catch (e) {
        console.error("Enterprise creation error:", e);
        alert("Failed to create enterprise");
        addLog("Enterprise creation error: " + e);
    }
}

async function generateQr() {
    resetUiForNewPayment();
    unsubscribeCurrentPayment();

    const request = {
        enterpriseCode: document.getElementById("paymentEnterpriseCode").value.trim(),
        terminalId: document.getElementById("terminalId").value.trim(),
        merchantName: document.getElementById("merchantName").value.trim(),
        upiId: document.getElementById("upiId").value.trim(),
        amount: parseFloat(document.getElementById("amount").value)
    };

    if (!request.enterpriseCode) {
        alert("Please enter enterprise code");
        return;
    }

    if (!request.terminalId) {
        alert("Please enter terminal ID");
        return;
    }

    if (!request.merchantName || !request.upiId || !request.amount) {
        alert("Please fill all payment fields");
        return;
    }

    try {
        const response = await fetch(PAYMENT_BASE_URL + "/qr/generate", {
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
            currentTerminalId = data.data.terminalId || request.terminalId;

            document.getElementById("paymentId").innerText = currentPaymentId || "-";
            document.getElementById("transactionRef").innerText = data.data.transactionRef || "-";
            document.getElementById("currentTerminalId").innerText = currentTerminalId || "-";

            updatePaymentStatus("PENDING");
            connectWebSocketAndSubscribe(currentPaymentId);
            startFallbackStatusCheck();

            addLog(
                "QR generated | paymentId=" + currentPaymentId +
                " | terminalId=" + currentTerminalId
            );
        } else {
            alert(data.message || "Error generating QR");
            addLog("QR generation failed");
        }
    } catch (e) {
        console.error("Generate QR error:", e);
        alert("Failed to generate QR");
        addLog("Generate QR error: " + e);
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
            addLog("WebSocket connection error");
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
            addLog("WebSocket parse error: " + e);
        }
    });

    updateSocketStatus("CONNECTED");
    addLog("Subscribed to " + destination);
}

function handlePaymentEvent(event) {
    if (!event || !event.paymentId) {
        return;
    }

    if (currentPaymentId !== event.paymentId) {
        return;
    }

    const status = (event.status || "UNKNOWN").toString();
    updatePaymentStatus(status);

    if (event.transactionRef) {
        document.getElementById("transactionRef").innerText = event.transactionRef;
    }

    addLog(
        "Payment event | paymentId=" + event.paymentId +
        " | status=" + status +
        " | txnRef=" + (event.transactionRef || "")
    );

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
    const el = document.getElementById("socketStatus");
    el.innerText = status;
    el.className = "status-pill " + getSocketStatusClass(status);
}

function getSocketStatusClass(status) {
    if (status === "CONNECTED") return "connected";
    if (status === "ERROR") return "error";
    if (status === "CONNECTING") return "connected";
    return "disconnected";
}

function updatePaymentStatus(status) {
    const el = document.getElementById("status");
    el.innerText = status;
    el.className = "status-pill " + getPaymentStatusClass(status);
}

function getPaymentStatusClass(status) {
    const value = (status || "").toUpperCase();

    if (value === "SUCCESS") return "success";
    if (value === "FAILED" || value === "EXPIRED") return "failed";
    return "pending";
}

function resetUiForNewPayment() {
    clearFallbackStatusCheck();

    currentPaymentId = null;
    currentTerminalId = null;

    updatePaymentStatus("PENDING");
    document.getElementById("paymentId").innerText = "-";
    document.getElementById("transactionRef").innerText = "-";
    document.getElementById("currentTerminalId").innerText = "-";
    document.getElementById("qrImage").src = "";
    document.getElementById("qrImage").style.display = "none";
    document.getElementById("qrPlaceholder").style.display = "block";

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
            const response = await fetch(PAYMENT_BASE_URL + "/status/" + currentPaymentId);
            const data = await response.json();

            if (data.success && data.data) {
                const status = data.data.status || "UNKNOWN";
                updatePaymentStatus(status);

                addLog("Fallback status check | paymentId=" + currentPaymentId + " | status=" + status);

                if (status === "SUCCESS") {
                    unsubscribeCurrentPayment();
                    alert("Payment Successful ✅");
                }
            }
        } catch (e) {
            console.error("Fallback status check error:", e);
            addLog("Fallback status check error: " + e);
        }
    }, 15000);
}

function clearFallbackStatusCheck() {
    if (fallbackTimeout) {
        clearTimeout(fallbackTimeout);
        fallbackTimeout = null;
    }
}

function addLog(message) {
    const logs = document.getElementById("logs");

    const empty = logs.querySelector(".log-empty");
    if (empty) {
        empty.remove();
    }

    const item = document.createElement("div");
    item.className = "log-item";
    item.innerText = "[" + new Date().toLocaleString() + "] " + message;

    logs.prepend(item);
}

window.addEventListener("beforeunload", function () {
    disconnectWebSocket();
});