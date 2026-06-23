let currentPaymentId = null;
let currentTerminalId = null;
let currentDocumentOwnCode = null;
let terminalList = [];

let enterpriseLoadTimer = null;
let lastLoadedEnterpriseCode = "";

let stompClient = null;
let currentSubscription = null;
let fallbackTimer = null;
let isSocketConnected = false;

const API_BASE_URL = "https://briskly-jawline-grief.ngrok-free.dev";
const ENTERPRISE_BASE_URL = API_BASE_URL + "/api/enterprise";
const PAYMENT_BASE_URL = API_BASE_URL + "/api/payment";
const DEVICE_BASE_URL = API_BASE_URL + "/api/device";
const WS_URL = API_BASE_URL + "/ws?ngrok-skip-browser-warning=true";
const FALLBACK_STATUS_INTERVAL_MS = 3000;
const NGROK_HEADERS = {
    "ngrok-skip-browser-warning": "true"
};

async function fetchJson(url, options) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...NGROK_HEADERS,
            ...(options && options.headers ? options.headers : {})
        }
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        const text = await response.text();
        throw new Error("Expected JSON response, got: " + text.slice(0, 120));
    }

    return response.json();
}

async function createEnterprise() {
    const enterpriseName = document.getElementById("enterpriseName").value.trim();
    const liveFrom = document.getElementById("liveFrom").value;

    if (!enterpriseName) {
        alert("Please enter enterprise name");
        return;
    }

    const request = {
        enterpriseName: enterpriseName,
        liveFrom: liveFrom ? new Date(liveFrom).toISOString() : null
    };

    try {
        const data = await fetchJson(ENTERPRISE_BASE_URL + "/create", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(request)
        });

        if (data.success && data.data) {
            const generatedEnterpriseCode = data.data.enterpriseCode || "";
            const createdEnterpriseName = data.data.enterpriseName || enterpriseName;

            document.getElementById("enterpriseResult").innerText =
                "Created: " + generatedEnterpriseCode + " | " + createdEnterpriseName;

            document.getElementById("paymentEnterpriseCode").value =
                generatedEnterpriseCode;

            addLog(
                "Enterprise created successfully | enterpriseCode=" +
                generatedEnterpriseCode +
                " | enterpriseName=" +
                createdEnterpriseName
            );

            lastLoadedEnterpriseCode = "";
            await loadTerminalsByEnterprise();
        } else {
            alert(data.message || "Failed to create enterprise");
            addLog("Enterprise creation failed: " + (data.message || ""));
        }
    } catch (e) {
        console.error("Enterprise creation error:", e);
        alert("Failed to create enterprise");
        addLog("Enterprise creation error: " + e);
    }
}

function onEnterpriseCodeChanged() {
    const enterpriseCode = document.getElementById("paymentEnterpriseCode").value.trim();

    clearTimeout(enterpriseLoadTimer);

    document.getElementById("terminalId").value = "";
    terminalList = [];

    if (!enterpriseCode) {
        lastLoadedEnterpriseCode = "";
        document.getElementById("terminalNameSelect").innerHTML =
            '<option value="">Enter enterprise code to load terminals</option>';
        return;
    }

    document.getElementById("terminalNameSelect").innerHTML =
        '<option value="">Typing enterprise code...</option>';

    enterpriseLoadTimer = setTimeout(function () {
        loadTerminalsByEnterprise();
    }, 600);
}

async function loadTerminalsByEnterprise() {
    const enterpriseCode = document.getElementById("paymentEnterpriseCode").value.trim();

    const terminalSelect = document.getElementById("terminalNameSelect");
    const terminalIdInput = document.getElementById("terminalId");

    terminalSelect.innerHTML = "";
    terminalIdInput.value = "";
    terminalList = [];

    if (!enterpriseCode) {
        lastLoadedEnterpriseCode = "";
        terminalSelect.innerHTML =
            '<option value="">Enter enterprise code to load terminals</option>';
        return;
    }

    if (enterpriseCode === lastLoadedEnterpriseCode && terminalList.length > 0) {
        return;
    }

    lastLoadedEnterpriseCode = enterpriseCode;

    terminalSelect.innerHTML =
        '<option value="">Loading terminals...</option>';

    try {
        const data = await fetchJson(
            DEVICE_BASE_URL + "/terminals?enterpriseCode=" + encodeURIComponent(enterpriseCode)
        );

        terminalSelect.innerHTML = "";

        if (!data.success || !data.data || data.data.length === 0) {
            terminalSelect.innerHTML =
                '<option value="">No registered terminals found</option>';

            addLog("No active terminals found for enterpriseCode=" + enterpriseCode);
            return;
        }

        terminalList = data.data;

        terminalSelect.innerHTML =
            '<option value="">Select terminal</option>';

        terminalList.forEach(function (terminal) {
            const option = document.createElement("option");

            option.value = terminal.terminalId;

            const deviceName = terminal.deviceName || "Unnamed Device";
            const role = terminal.role || "-";
            const terminalId = terminal.terminalId || "-";

            option.text =
                deviceName + " | " + role + " | " + terminalId;

            terminalSelect.appendChild(option);
        });

        addLog(
            "Loaded " + terminalList.length +
            " terminal(s) for enterpriseCode=" + enterpriseCode
        );
    } catch (e) {
        console.error("Load terminals error:", e);
        lastLoadedEnterpriseCode = "";

        terminalSelect.innerHTML =
            '<option value="">Failed to load terminals</option>';

        addLog("Load terminals error: " + e);
    }
}

function onTerminalSelected() {
    const terminalSelect = document.getElementById("terminalNameSelect");
    const terminalIdInput = document.getElementById("terminalId");

    const selectedTerminalId = terminalSelect.value || "";
    terminalIdInput.value = selectedTerminalId;

    if (!selectedTerminalId) {
        return;
    }

    const terminal = terminalList.find(function (item) {
        return item.terminalId === selectedTerminalId;
    });

    if (terminal) {
        addLog(
            "Selected terminal | name=" +
            (terminal.deviceName || "-") +
            " | role=" +
            (terminal.role || "-") +
            " | terminalId=" +
            selectedTerminalId
        );
    }
}

async function generateQr() {
    resetUiForNewPayment();
    unsubscribeCurrentPayment();

    const enterpriseCode = document.getElementById("paymentEnterpriseCode").value.trim();
    const terminalId = document.getElementById("terminalId").value.trim();
    const merchantName = document.getElementById("merchantName").value.trim();
    const upiId = document.getElementById("upiId").value.trim();
    const amount = parseFloat(document.getElementById("amount").value);
    const documentOwnCodeValue = document.getElementById("documentOwnCode").value.trim();

    const documentOwnCode = documentOwnCodeValue
        ? parseInt(documentOwnCodeValue, 10)
        : null;

    const request = {
        enterpriseCode: enterpriseCode,
        terminalId: terminalId,
        merchantName: merchantName,
        upiId: upiId,
        amount: amount,
        sourceApp: "WEB",
        documentOwnCode: documentOwnCode
    };

    if (!request.enterpriseCode) {
        alert("Please enter enterprise code");
        return;
    }

    if (!request.terminalId) {
        alert("Please select terminal");
        return;
    }

    if (!request.merchantName || !request.upiId || !request.amount) {
        alert("Please fill all payment fields");
        return;
    }

    if (documentOwnCodeValue && Number.isNaN(documentOwnCode)) {
        alert("Please enter valid document own code");
        return;
    }

    try {
        const data = await fetchJson(PAYMENT_BASE_URL + "/qr/generate", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(request)
        });

        if (data.success && data.data) {
            const qrBase64 = data.data.qrImageBase64;

            document.getElementById("qrImage").src =
                "data:image/png;base64," + qrBase64;

            currentPaymentId = data.data.paymentId;
            currentTerminalId = data.data.terminalId || request.terminalId;
            currentDocumentOwnCode = data.data.documentOwnCode || request.documentOwnCode;

            document.getElementById("paymentId").innerText = currentPaymentId || "-";
            document.getElementById("transactionRef").innerText =
                data.data.transactionRef || "-";
            document.getElementById("currentTerminalId").innerText =
                currentTerminalId || "-";
            document.getElementById("currentDocumentOwnCode").innerText =
                currentDocumentOwnCode || "-";

            updatePaymentStatus("PENDING");
            connectWebSocketAndSubscribe(currentPaymentId);
            startFallbackStatusCheck();

            addLog(
                "QR generated | paymentId=" + currentPaymentId +
                " | terminalId=" + currentTerminalId +
                " | documentOwnCode=" + (currentDocumentOwnCode || "-")
            );
        } else {
            alert(data.message || "Error generating QR");
            addLog("QR generation failed: " + (data.message || ""));
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
            updateSocketStatus(currentPaymentId ? "POLLING" : "ERROR");
            addLog("WebSocket connection error. Using fallback status polling.");
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
    const normalizedStatus = status.toUpperCase();
    updatePaymentStatus(status);

    if (event.transactionRef) {
        document.getElementById("transactionRef").innerText = event.transactionRef;
    }

    addLog(
        "Payment event | paymentId=" + event.paymentId +
        " | status=" + status +
        " | txnRef=" + (event.transactionRef || "")
    );

    if (normalizedStatus === "SUCCESS") {
        clearFallbackStatusCheck();
        unsubscribeCurrentPayment();
        alert("Payment Successful ✅");
    } else if (isFinalPaymentStatus(status)) {
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
    if (status === "POLLING") return "connected";
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
    currentDocumentOwnCode = null;

    updatePaymentStatus("PENDING");
    document.getElementById("paymentId").innerText = "-";
    document.getElementById("transactionRef").innerText = "-";
    document.getElementById("currentTerminalId").innerText = "-";
    document.getElementById("currentDocumentOwnCode").innerText = "-";

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

    checkPaymentStatus();
    fallbackTimer = setInterval(checkPaymentStatus, FALLBACK_STATUS_INTERVAL_MS);
}

async function checkPaymentStatus() {
    if (!currentPaymentId) {
        clearFallbackStatusCheck();
        return;
    }

    try {
        const data = await fetchJson(
            PAYMENT_BASE_URL + "/status/" + currentPaymentId
        );

        if (data.success && data.data) {
            const status = data.data.status || "UNKNOWN";
            updatePaymentStatus(status);

            if (data.data.transactionRef) {
                document.getElementById("transactionRef").innerText =
                    data.data.transactionRef;
            }

            addLog(
                "Fallback status check | paymentId=" +
                currentPaymentId +
                " | status=" +
                status
            );

            if (isFinalPaymentStatus(status)) {
                clearFallbackStatusCheck();
                unsubscribeCurrentPayment();

                if (status.toUpperCase() === "SUCCESS") {
                    alert("Payment Successful ✅");
                }
            }
        }
    } catch (e) {
        console.error("Fallback status check error:", e);
        addLog("Fallback status check error: " + e);
    }
}

function isFinalPaymentStatus(status) {
    const value = (status || "").toUpperCase();
    return (
        value === "SUCCESS" ||
        value === "FAILED" ||
        value === "PENDING_REVIEW" ||
        value === "EXPIRED"
    );
}

function clearFallbackStatusCheck() {
    if (fallbackTimer) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
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
