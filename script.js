let currentPaymentId = null;
let currentTerminalId = null;
let currentDocumentOwnCode = null;
let currentPhonePeNotificationId = null;
let successAlertShown = false;
let terminalList = [];
let departmentList = [];

let enterpriseLoadTimer = null;
let lastLoadedEnterpriseCode = "";

let stompClient = null;
let currentSubscription = null;
let fallbackTimer = null;
let isSocketConnected = false;

const API_BASE_URL = "https://briskly-jawline-grief.ngrok-free.dev";
const ENTERPRISE_BASE_URL = API_BASE_URL + "/api/enterprise";
const PAYMENT_BASE_URL = API_BASE_URL + "/api/payment";
const PAYMENTS_BASE_URL = API_BASE_URL + "/api/payments";
const DEVICE_BASE_URL = API_BASE_URL + "/api/device";
const WS_URL = API_BASE_URL + "/ws?ngrok-skip-browser-warning=true";
const FALLBACK_STATUS_INTERVAL_MS = 3000;
const NGROK_HEADERS = {
    "ngrok-skip-browser-warning": "true"
};
const FALLBACK_DEPARTMENTS = [
    {
        department: "PADM",
        departmentCode: 1
    },
    {
        department: "INFINITY",
        departmentCode: 2
    },
    {
        department: "INSIGHT",
        departmentCode: 3
    }
];

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

function normalizeEnterpriseCodeField(input) {
    input.value = input.value.trim().toUpperCase();
}

function parseOptionalInteger(value) {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
        return null;
    }

    const parsedValue = parseInt(trimmedValue, 10);
    return Number.isNaN(parsedValue) ? NaN : parsedValue;
}

function displayValue(value) {
    return value === null || value === undefined || value === "" ? "-" : value;
}

function renderDepartmentOptions(departments) {
    const departmentSelect = document.getElementById("enterpriseDepartment");
    departmentSelect.innerHTML = '<option value="">Select department</option>';

    departments.forEach(function (item) {
        const option = document.createElement("option");
        option.value = String(item.departmentCode);
        option.text = item.department + " (" + item.departmentCode + ")";
        option.dataset.department = item.department;
        option.dataset.departmentCode = String(item.departmentCode);
        departmentSelect.appendChild(option);
    });
}

async function loadEnterpriseDepartments() {
    try {
        const data = await fetchJson(ENTERPRISE_BASE_URL + "/departments");

        if (data.success && Array.isArray(data.data) && data.data.length > 0) {
            departmentList = data.data;
            renderDepartmentOptions(departmentList);
            addLog("Loaded " + departmentList.length + " enterprise department(s)");
            return;
        }

        throw new Error(data.message || "No departments returned");
    } catch (e) {
        console.error("Load departments error:", e);
        departmentList = FALLBACK_DEPARTMENTS;
        renderDepartmentOptions(departmentList);
        addLog("Using fallback enterprise departments: " + e);
    }
}

async function createEnterprise() {
    const enterpriseCode = document.getElementById("enterpriseCode").value.trim().toUpperCase();
    const enterpriseName = document.getElementById("enterpriseName").value.trim();
    const departmentSelect = document.getElementById("enterpriseDepartment");
    const liveFrom = document.getElementById("liveFrom").value;
    const selectedOption = departmentSelect.options[departmentSelect.selectedIndex];
    const department = selectedOption ? selectedOption.dataset.department : "";
    const departmentCode = selectedOption ? parseInt(selectedOption.dataset.departmentCode, 10) : null;

    if (!enterpriseCode) {
        alert("Please enter enterprise code");
        return;
    }

    if (!enterpriseName) {
        alert("Please enter enterprise name");
        return;
    }

    if (!department || Number.isNaN(departmentCode)) {
        alert("Please select department");
        return;
    }

    const request = {
        enterpriseCode: enterpriseCode,
        enterpriseName: enterpriseName,
        department: department,
        departmentCode: departmentCode,
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
            const createdEnterpriseCode = data.data.enterpriseCode || enterpriseCode;
            const createdEnterpriseName = data.data.enterpriseName || enterpriseName;
            const createdDepartment = data.data.department || department;
            const createdDepartmentCode = data.data.departmentCode || departmentCode;

            document.getElementById("enterpriseResult").innerText =
                "Created: " +
                createdEnterpriseCode +
                " | " +
                createdEnterpriseName +
                " | " +
                createdDepartment +
                " (" +
                createdDepartmentCode +
                ")";

            document.getElementById("paymentEnterpriseCode").value =
                createdEnterpriseCode;

            addLog(
                "Enterprise created successfully | enterpriseCode=" +
                createdEnterpriseCode +
                " | enterpriseName=" +
                createdEnterpriseName +
                " | department=" +
                createdDepartment +
                " | departmentCode=" +
                createdDepartmentCode
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
    lastLoadedEnterpriseCode = "";

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
    const selectedTerminalId = terminalIdInput.value.trim();

    terminalSelect.innerHTML = "";
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

        if (!data.success || !Array.isArray(data.data) || data.data.length === 0) {
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

        if (selectedTerminalId) {
            terminalIdInput.value = selectedTerminalId;
            terminalSelect.value = selectedTerminalId;
        }

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

function onTerminalIdChanged() {
    const terminalIdInput = document.getElementById("terminalId");
    const terminalSelect = document.getElementById("terminalNameSelect");
    const typedTerminalId = terminalIdInput.value.trim();

    if (!typedTerminalId) {
        terminalSelect.value = "";
        return;
    }

    const terminal = terminalList.find(function (item) {
        return item.terminalId === typedTerminalId;
    });

    terminalSelect.value = terminal ? typedTerminalId : "";
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

    const documentOwnCode = parseOptionalInteger(documentOwnCodeValue);

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
            currentDocumentOwnCode = data.data.documentOwnCode !== null && data.data.documentOwnCode !== undefined
                ? data.data.documentOwnCode
                : request.documentOwnCode;

            document.getElementById("paymentId").innerText = currentPaymentId || "-";
            document.getElementById("transactionRef").innerText =
                data.data.transactionRef || "-";
            document.getElementById("currentTerminalId").innerText =
                currentTerminalId || "-";
            document.getElementById("currentDocumentOwnCode").innerText =
                displayValue(currentDocumentOwnCode);

            updatePaymentStatus(data.data.status || "WAITING");
            connectWebSocketAndSubscribe(currentPaymentId);
            startFallbackStatusCheck();

            addLog(
                "QR generated | paymentId=" + currentPaymentId +
                " | terminalId=" + currentTerminalId +
                " | documentOwnCode=" + displayValue(currentDocumentOwnCode)
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

    if (event.eventType === "PHONEPE_PAYMENT_CONFIRMATION_REQUIRED") {
        showPhonePeConfirmation(event);
    }

    const status = (event.status || getStatusFromEventType(event.eventType) || "UNKNOWN").toString();
    const normalizedStatus = status.toUpperCase();
    updatePaymentStatus(status);

    if (!isPhonePeConfirmationStatus(normalizedStatus)) {
        hidePhonePeConfirmation();
    }

    if (event.transactionRef) {
        document.getElementById("transactionRef").innerText = event.transactionRef;
    }

    addLog(
        "Payment event | paymentId=" + event.paymentId +
        " | eventType=" + (event.eventType || "-") +
        " | status=" + status +
        " | txnRef=" + (event.transactionRef || "")
    );

    if (isSuccessfulPaymentStatus(normalizedStatus)) {
        clearFallbackStatusCheck();
        unsubscribeCurrentPayment();
        showPaymentSuccessAlert("Payment Successful");
    } else if (isFinalPaymentStatus(status)) {
        clearFallbackStatusCheck();
        unsubscribeCurrentPayment();
    }
}

function getStatusFromEventType(eventType) {
    if (eventType === "PHONEPE_PAYMENT_CONFIRMATION_REQUIRED") {
        return "PHONEPE_MATCHED_WAITING_CONFIRMATION";
    }

    return "";
}

function showPhonePeConfirmation(event) {
    currentPhonePeNotificationId = event.notificationId;
    const hasNotificationId =
        event.notificationId !== null &&
        event.notificationId !== undefined &&
        event.notificationId !== "";

    document.getElementById("phonePeConfirmationPanel").style.display = "block";
    document.getElementById("phonePeConfirmationMessage").innerText =
        event.message || "PhonePe payment received. Please confirm after checking customer.";
    document.getElementById("phonePeNotificationId").innerText =
        displayValue(event.notificationId);
    document.getElementById("phonePeAmount").innerText =
        displayValue(event.amount);
    document.getElementById("phonePePayer").innerText =
        displayValue(event.payerName);
    document.getElementById("phonePeConfirmBtn").disabled = !hasNotificationId;
    document.getElementById("phonePeRejectBtn").disabled = !hasNotificationId;

    addLog(
        "PhonePe confirmation required | notificationId=" +
        displayValue(event.notificationId) +
        " | amount=" +
        displayValue(event.amount) +
        " | payer=" +
        displayValue(event.payerName)
    );
}

function hidePhonePeConfirmation() {
    currentPhonePeNotificationId = null;

    document.getElementById("phonePeConfirmationPanel").style.display = "none";
    document.getElementById("phonePeConfirmationMessage").innerText =
        "Waiting for PhonePe match";
    document.getElementById("phonePeNotificationId").innerText = "-";
    document.getElementById("phonePeAmount").innerText = "-";
    document.getElementById("phonePePayer").innerText = "-";
    document.getElementById("phonePeRejectReason").value = "";
    document.getElementById("phonePeConfirmBtn").disabled = true;
    document.getElementById("phonePeRejectBtn").disabled = true;
}

async function confirmPhonePePayment() {
    if (!currentPaymentId || !currentPhonePeNotificationId) {
        alert("No PhonePe payment is waiting for confirmation");
        return;
    }

    await submitPhonePeAction("confirm", {
        notificationId: currentPhonePeNotificationId
    });
}

async function rejectPhonePePayment() {
    const reason = document.getElementById("phonePeRejectReason").value.trim();

    if (!currentPaymentId || !currentPhonePeNotificationId) {
        alert("No PhonePe payment is waiting for rejection");
        return;
    }

    if (!reason) {
        alert("Please enter reject reason");
        return;
    }

    await submitPhonePeAction("reject", {
        notificationId: currentPhonePeNotificationId,
        reason: reason
    });
}

async function submitPhonePeAction(action, request) {
    setPhonePeActionButtonsDisabled(true);

    try {
        const data = await fetchJson(
            PAYMENTS_BASE_URL +
            "/" +
            encodeURIComponent(currentPaymentId) +
            "/phonepe/" +
            action,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(request)
            }
        );

        if (data.success) {
            const status = data.data && data.data.status
                ? data.data.status
                : action === "confirm"
                    ? "PAID_CONFIRMED_BY_CASHIER"
                    : "WAITING";

            updatePaymentStatus(status);
            addLog("PhonePe " + action + " success: " + (data.message || ""));

            if (action === "confirm") {
                clearFallbackStatusCheck();
                unsubscribeCurrentPayment();
                hidePhonePeConfirmation();
                showPaymentSuccessAlert("PhonePe payment confirmed successfully.");
            } else {
                hidePhonePeConfirmation();
                const latestStatus = await checkPaymentStatus();
                if (!isFinalPaymentStatus(latestStatus)) {
                    startFallbackStatusCheck();
                }
            }
        } else {
            alert(data.message || "PhonePe " + action + " failed");
            addLog("PhonePe " + action + " failed: " + (data.message || ""));
            setPhonePeActionButtonsDisabled(false);
        }
    } catch (e) {
        console.error("PhonePe " + action + " error:", e);
        alert("PhonePe " + action + " failed");
        addLog("PhonePe " + action + " error: " + e);
        setPhonePeActionButtonsDisabled(false);
    }
}

function setPhonePeActionButtonsDisabled(disabled) {
    document.getElementById("phonePeConfirmBtn").disabled = disabled;
    document.getElementById("phonePeRejectBtn").disabled = disabled;
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

    if (isSuccessfulPaymentStatus(value)) return "success";
    if (isPhonePeConfirmationStatus(value)) {
        return "action-required";
    }
    if (value === "FAILED" || value === "EXPIRED" || value === "REJECTED_BY_CASHIER") return "failed";
    return "pending";
}

function resetUiForNewPayment() {
    clearFallbackStatusCheck();

    currentPaymentId = null;
    currentTerminalId = null;
    currentDocumentOwnCode = null;
    currentPhonePeNotificationId = null;
    successAlertShown = false;

    updatePaymentStatus("WAITING");
    document.getElementById("paymentId").innerText = "-";
    document.getElementById("transactionRef").innerText = "-";
    document.getElementById("currentTerminalId").innerText = "-";
    document.getElementById("currentDocumentOwnCode").innerText = "-";
    hidePhonePeConfirmation();

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
        return "";
    }

    try {
        const data = await fetchJson(
            PAYMENT_BASE_URL + "/status/" + encodeURIComponent(currentPaymentId)
        );

        if (data.success && data.data) {
            const status = data.data.status || "UNKNOWN";
            updatePaymentStatus(status);

            if (isPhonePeConfirmationStatus(status)) {
                showPhonePeConfirmation(data.data);
            } else {
                hidePhonePeConfirmation();
            }

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

                hidePhonePeConfirmation();

                if (isSuccessfulPaymentStatus(status)) {
                    showPaymentSuccessAlert("Payment Successful");
                }
            }

            return status;
        }
    } catch (e) {
        console.error("Fallback status check error:", e);
        addLog("Fallback status check error: " + e);
    }

    return "";
}

function isFinalPaymentStatus(status) {
    const value = (status || "").toUpperCase();
    return (
        isSuccessfulPaymentStatus(value) ||
        value === "FAILED" ||
        value === "PENDING_REVIEW" ||
        value === "EXPIRED" ||
        value === "REJECTED_BY_CASHIER"
    );
}

function isPhonePeConfirmationStatus(status) {
    const value = (status || "").toUpperCase();
    return (
        value === "PHONEPE_MATCHED_WAITING_CONFIRMATION" ||
        value === "MATCHED_WAITING_CONFIRMATION"
    );
}

function isSuccessfulPaymentStatus(status) {
    const value = (status || "").toUpperCase();
    return (
        value === "SUCCESS" ||
        value === "PAID_AUTO_VERIFIED" ||
        value === "PAID_CONFIRMED_BY_CASHIER"
    );
}

function showPaymentSuccessAlert(message) {
    if (successAlertShown) {
        return;
    }

    successAlertShown = true;
    alert(message);
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

window.addEventListener("DOMContentLoaded", function () {
    loadEnterpriseDepartments();
});
