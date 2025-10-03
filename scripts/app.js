// ************* 중요!! *************
// Firebase 콘솔에서 확인한 내 프로젝트의 설정 정보를 여기에 붙여넣으세요.
const firebaseConfig = {
  apiKey: "AIzaSyDA0BNmhnr37KqyI7oj766TwB8FrejsRzo",
  authDomain: "my-inventory-final.firebaseapp.com",
  projectId: "my-inventory-final",
  storageBucket: "my-inventory-final.firebasestorage.app",
  messagingSenderId: "740246970535",
  appId: "1:740246970535:web:f7738b92a6097671f67b82",
  measurementId: "G-4ZF63VWX6Z"
};
// **********************************

// Firebase 앱 초기화
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Firestore 컬렉션 참조
const transactionsCollection = db.collection('transactions');
const importCostSheetsCollection = db.collection('importCostSheets');

// 전역 변수
let inventory = [];
let transactions = [];
let ic_costSheets = [];
let editingTransactionId = null;
let ic_editingId = null;
let currentBackupFile = null;

// ================== 1. 인증 및 앱 초기화 (실시간 동기화 적용) ==================

auth.onAuthStateChanged(user => {
    if (user) {
        console.log('로그인 된 사용자:', user.email);
        initializeUIOnFirstLoad();
        setupRealtimeListeners();
    } else {
        console.log('로그인 필요');
        window.location.href = 'login.html';
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    auth.signOut().then(() => {
        console.log('로그아웃 성공');
        window.location.href = 'login.html';
    }).catch(error => console.error('로그아웃 실패:', error));
});

function setupRealtimeListeners() {
    console.log("Firestore 실시간 리스너를 시작합니다...");

    transactionsCollection.onSnapshot(snapshot => {
        transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`입출고 데이터 실시간 업데이트: ${transactions.length}건`);
        updateAll();
    }, error => {
        console.error("입출고 리스너 오류:", error);
        alert("입출고 데이터를 실시간으로 동기화하는 데 실패했습니다. Firebase 보안 규칙을 확인해주세요.");
    });

    importCostSheetsCollection.onSnapshot(snapshot => {
        ic_costSheets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`수입원가 데이터 실시간 업데이트: ${ic_costSheets.length}건`);
        ic_renderList();
    }, error => {
        console.error("수입원가 리스너 오류:", error);
        alert("수입원가 데이터를 실시간으로 동기화하는 데 실패했습니다.");
    });
}

function initializeUIOnFirstLoad() {
    console.log("UI 초기화를 시작합니다...");
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('transaction-date').value = today;
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    document.getElementById('invoice-start-date').value = firstDayOfMonth;
    document.getElementById('invoice-end-date').value = today;

    bindEventListeners();
    ic_addItemRow();
    console.log("초기 UI 설정 완료.");
}

function bindEventListeners() {
    ['filter-inv-brand', 'filter-inv-category', 'filter-inv-spec', 'filter-inv-lot',
     'filter-tran-type', 'filter-tran-month', 'filter-tran-brand', 'filter-tran-category',
     'filter-tran-spec', 'filter-tran-lot', 'filter-tran-company']
    .forEach(id => document.getElementById(id).addEventListener('input', applyFiltersAndRender));

    ['filter-sales-start-date', 'filter-sales-end-date', 'filter-sales-company', 'filter-sales-brand']
    .forEach(id => document.getElementById(id).addEventListener('input', generateSalesReport));

    document.getElementById('tran-brand').addEventListener('blur', autoFillItemDetails);
    document.getElementById('tran-lot').addEventListener('blur', autoFillItemDetails);
}

// ================== 2. Firebase 데이터 처리 (CRUD) ==================
async function processTransaction(isEdit) {
    const type = document.getElementById('transaction-type').value;
    const date = document.getElementById('transaction-date').value;
    // ... (이하 데이터 읽는 코드는 동일)
    const brand = document.getElementById('tran-brand').value.trim();
    const lot = document.getElementById('tran-lot').value.trim();
    const company = document.getElementById('transaction-company').value.trim();
    const weight = Number(document.getElementById('transaction-weight').value) || 0;
    const unitPrice = Number(document.getElementById('transaction-unit-price').value) || 0;
    const otherCosts = Number(document.getElementById('transaction-other-costs').value) || 0;

    if (!date || !brand || !lot || weight <= 0 || !company) {
        return alert('필수 항목(날짜, 브랜드, LOT, 중량, 업체)을 모두 입력해주세요.');
    }

    const record = {
        type, date, brand, lot, weight, unitPrice, company, otherCosts,
        category: document.getElementById('tran-category').value.trim(),
        spec: document.getElementById('tran-spec').value.trim(),
        notes: document.getElementById('transaction-notes').value.trim(),
        destination: document.getElementById('transaction-destination').value.trim(),
        specialNotes: document.getElementById('transaction-special-notes').value.trim()
    };

    try {
        if (isEdit && editingTransactionId) {
            await transactionsCollection.doc(editingTransactionId).update(record);
            alert('거래내역이 성공적으로 수정되었습니다.');
        } else {
            await transactionsCollection.add(record);
            alert('입출고 내역이 성공적으로 등록되었습니다.');
        }
        cancelTransactionEdit();
    } catch (error) {
        console.error("데이터 저장/수정 오류:", error);
        alert(`데이터를 처리하는 중 오류가 발생했습니다. 다시 시도해주세요.\n\n오류: ${error.message}`);
    }
}

// ... (deleteSelectedTransactions, processBulkTransactions 등 다른 CRUD 함수는 이전과 동일)

// [오류 수정] HTML 구조 변경에 맞춰 form.reset() 사용
function cancelTransactionEdit() {
    editingTransactionId = null;
    const form = document.getElementById('transaction-form');
    if (form) {
        form.reset();
    }
    document.getElementById('transaction-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('transaction-form-title').innerText = '입출고 등록';
    document.getElementById('transaction-form-buttons').innerHTML = `
        <button class="btn btn-primary" onclick="processTransaction(false)">입출고 등록</button>
        <button class="btn btn-warning" onclick="openBulkUploadModal()">대량 입출고 등록</button>`;
    toggleOtherCostsField();
}


// (이하 나머지 모든 함수는 이전 최종본과 동일합니다)
// ... (이전 답변의 나머지 모든 함수를 여기에 붙여넣으세요)
// ... (updateAll, updateTransactionTable, generateBill, ic_processCostSheet 등...)
