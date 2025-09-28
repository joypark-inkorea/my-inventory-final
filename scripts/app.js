// 🔥 중요: 이 곳에 본인의 Firebase 프로젝트 설정 키를 붙여넣으세요.
const firebaseConfig = {
 apiKey: "AIzaSyDA0BNmhnr37KqyI7oj766TwB8FrejsRzo",
  authDomain: "my-inventory-final.firebaseapp.com",
  projectId: "my-inventory-final",
  storageBucket: "my-inventory-final.firebasestorage.app",
  messagingSenderId: "740246970535",
  appId: "1:740246970535:web:f7738b92a6097671f67b82",
  measurementId: "G-4ZF63VWX6Z"
};

// Firebase 앱 초기화
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();
let currentUser = null;

// 🚪 문지기 코드: 로그인 상태를 확인하여 페이지 접근을 제어합니다.
auth.onAuthStateChanged(user => {
    const loader = document.getElementById('loader');
    const appContent = document.getElementById('app-content');
    if (user) {
        currentUser = user;
        if (loader) loader.style.display = 'none';
        if (appContent) appContent.style.display = 'block';
        startApp(); // 앱의 실제 기능을 시작합니다.
    } else {
        // 로그아웃 상태이거나 세션이 만료되면 로그인 페이지로 이동
        window.location.href = 'login.html';
    }
});

// ===============================================================
//      ↓↓↓ 이 아래는 startApp 함수 하나로 모든 것을 관리합니다 ↓↓↓
// ===============================================================

function startApp() {
    // ----------------- 전역 변수 선언 -----------------
    let inventory = [];
    let transactions = [];
    let ic_costSheets = [];
    let editingInventoryId = null;
    let editingTransactionId = null;
    let currentBackupFile = null;
    let ic_editingId = null;

    // ----------------- Firebase 데이터 관리 (저장 기능 강화) -----------------
    async function loadAllDataFromFirebase() {
        if (!currentUser) return;
        const docRef = db.collection('inventoryData').doc(currentUser.uid);
        try {
            const doc = await docRef.get();
            if (doc.exists && doc.data()) {
                const data = doc.data();
                transactions = data.transactions || [];
                ic_costSheets = data.costSheets || [];
            } else {
                transactions = [{ id: 'sample-1', type: '입고', date: '2025-01-01', weight: 100, unitPrice: 1000, company: '(주)샘플', notes: '샘플 데이터', brand: '샘플', lot: 'SAMPLE-001', category: '샘플', spec: '샘플', destination: '', specialNotes: '', otherCosts: 0 }];
                ic_costSheets = [];
            }
        } catch (error) {
            console.error("Firebase 데이터 로딩 오류:", error);
        }
        initializeAppUI();
    }

    async function saveAllDataToFirebase() {
        if (!currentUser) {
            console.error("저장 실패: 로그인된 사용자가 없습니다.");
            return;
        }
        const docRef = db.collection('inventoryData').doc(currentUser.uid);
        try {
            // Firestore가 undefined 값을 저장하지 못하므로, 데이터를 저장하기 전에 '정제'하는 과정을 추가합니다.
            const cleanData = (obj) => JSON.parse(JSON.stringify(obj, (key, value) => (value === undefined ? null : value)));
            
            await docRef.set({
                transactions: cleanData(transactions),
                costSheets: cleanData(ic_costSheets)
            });
            console.log("Firebase에 데이터가 성공적으로 저장되었습니다.");
        } catch (error) {
            console.error("Firebase 데이터 저장 중 치명적인 오류 발생:", error);
            alert("데이터 저장에 실패했습니다. 인터넷 연결을 확인하고 다시 시도해주세요.");
        }
    }

    // 기존 저장 함수를 Firebase 함수로 교체
    const saveData = saveAllDataToFirebase;
    const ic_saveData = saveAllDataToFirebase;
    
    // ----------------- 원본 JS의 모든 함수 정의 -----------------
    const ic_pFloat = (val) => parseFloat(String(val).replace(/,/g, '')) || 0;
    
    // (이 공간에 원본 파일의 모든 JS 함수가 그대로 위치합니다)
    // (ic_formatInputForDisplay 부터 updateDatalists 까지)
    // ...
    // ... (코드가 너무 길어 생략) ...
    // ...
    function updateAll() {
        recalculateInventory();
        applyFiltersAndRender();
        updateDatalists();
        saveData(); // 모든 업데이트 후 최종적으로 저장 함수 호출
        generateSalesReport();
        ic_renderList();
    }

    // ----------------- HTML의 onclick에서 호출될 함수들을 전역에 할당 -----------------
    Object.assign(window, {
        showTab, toggleOtherCostsField, addTransaction, openBulkUploadModal,
        resetTransactionFilters, editSelectedTransaction, deleteSelectedTransactions,
        exportTransactionCSV, toggleAllCheckboxes, resetInventoryFilters,
        exportInventoryCSV, showItemHistoryInTransactionTab, saveInventoryItem,
        cancelInventoryEdit, deleteInventoryItem, saveTransaction, cancelTransactionEdit,
        autoFillItemDetails, deleteTransaction, closeBulkUploadModal,
        downloadBulkTransactionTemplate, processBulkUpload,
        backupDataToJson, loadBackupFile, restoreDataFromJson,
        ic_addItemRow, ic_calculateAll, ic_formatInputForDisplay, ic_printForm,
        ic_openBulkUploadModal, ic_addCostSheet, ic_updateCostSheet, ic_clearForm,
        ic_resetFilters, ic_exportListToCsv, ic_editSelectedSheet,
        ic_deleteSelectedSheets, ic_toggleAllListCheckboxes, ic_closeBulkUploadModal,
        ic_downloadBulkTemplate, ic_processBulkUpload,
        generateInvoice, printInvoice, saveInvoiceAsPDF,
        generateSalesReport, resetSalesReportFilters, exportSalesReportCSV
    });

    // ----------------- UI 초기화 및 이벤트 리스너 -----------------
    function initializeAppUI() {
        // 데이터 클리닝
        transactions = transactions.map(t => ({
            ...t,
            id: t.id || generateUniqueTransactionId(t),
            // (기타 필드들의 기본값 설정...)
        }));
        
        // 이벤트 리스너 연결
        connectEventListeners();
        
        // 초기 화면 렌더링
        updateAll();
    }
    
    function connectEventListeners() {
        document.getElementById('logout-button').addEventListener('click', () => {
            auth.signOut().catch(error => console.error("Logout Error:", error));
        });

        // 원본의 DOMContentLoaded에 있던 모든 이벤트 리스너를 여기에 추가
        document.getElementById('transaction-type').addEventListener('change', toggleOtherCostsField);
        document.getElementById('tran-brand').addEventListener('blur', autoFillItemDetails);
        document.getElementById('tran-lot').addEventListener('blur', autoFillItemDetails);
        document.getElementById('tran-category').addEventListener('blur', autoFillItemDetails);
        document.getElementById('tran-spec').addEventListener('blur', autoFillItemDetails);
        document.getElementById('filter-inv-brand').addEventListener('input', applyFiltersAndRender);
        document.getElementById('filter-inv-category').addEventListener('input', applyFiltersAndRender);
        document.getElementById('filter-inv-spec').addEventListener('input', applyFiltersAndRender);
        document.getElementById('filter-inv-lot').addEventListener('input', applyFiltersAndRender);
        document.getElementById('filter-tran-type').addEventListener('input', applyFiltersAndRender);
        document.getElementById('filter-tran-month').addEventListener('input', applyFiltersAndRender);
        document.getElementById('filter-tran-brand').addEventListener('input', applyFiltersAndRender);
        document.getElementById('filter-tran-category').addEventListener('input', applyFiltersAndRender);
        document.getElementById('filter-tran-spec').addEventListener('input', applyFiltersAndRender);
        document.getElementById('filter-tran-lot').addEventListener('input', applyFiltersAndRender);
        document.getElementById('filter-tran-company').addEventListener('input', applyFiltersAndRender);
        document.getElementById('filter-sales-month').addEventListener('input', generateSalesReport);
        document.getElementById('filter-sales-company').addEventListener('input', generateSalesReport);
        document.getElementById('filter-sales-brand').addEventListener('input', generateSalesReport);
        if (document.getElementById('filter-year')) {
            document.getElementById('filter-year').addEventListener('input', ic_renderList);
            document.getElementById('filter-shipper').addEventListener('input', ic_renderList);
            document.getElementById('filter-item').addEventListener('input', ic_renderList);
            document.getElementById('filter-lot').addEventListener('input', ic_renderList);
        }
    }
    
    // 앱 실행 시작점
    loadAllDataFromFirebase();
}
