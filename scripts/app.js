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

// ================== 0. 페이지 로딩 완료 후 실행 ==================
document.addEventListener('DOMContentLoaded', () => {
    const bulkCsvFileInput = document.getElementById('ic_bulk-csv-file');
    const bulkUploadProcessBtn = document.getElementById('ic_bulk-upload-process-btn');
    if (bulkCsvFileInput && bulkUploadProcessBtn) {
        bulkCsvFileInput.addEventListener('change', () => {
            bulkUploadProcessBtn.disabled = bulkCsvFileInput.files.length === 0;
        });
    }
});

// ================== 1. 인증 및 앱 초기화 ==================
auth.onAuthStateChanged(user => {
    if (user) {
        console.log('로그인 된 사용자:', user.email);
        loadAllDataFromFirebase();
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

function loadAllDataFromFirebase() {
    console.log("Firestore에서 실시간 데이터 동기화를 시작합니다...");

    transactionsCollection.onSnapshot(snapshot => {
        if (editingTransactionId) {
            const stillExists = snapshot.docs.some(doc => doc.id === editingTransactionId);
            if (!stillExists) {
                alert('현재 수정하던 항목이 다른 곳에서 삭제되어 수정 모드를 안전하게 취소합니다.');
                cancelTransactionEdit();
            }
        }
        transactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`입출고 데이터 실시간 업데이트됨. 총 ${transactions.length}건`);
        updateAll();
    }, error => {
        console.error("입출고 내역 실시간 동기화 오류:", error);
        alert("입출고 내역을 실시간으로 동기화하는 데 실패했습니다.");
    });

    importCostSheetsCollection.onSnapshot(snapshot => {
        ic_costSheets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`수입원가 데이터 실시간 업데이트됨. 총 ${ic_costSheets.length}건`);
        ic_renderList();
    }, error => {
        console.error("수입원가 정산서 실시간 동기화 오류:", error);
        alert("수입원가 정산서 목록을 실시간으로 동기화하는 데 실패했습니다.");
    });

    initializeAppUI();
}

function initializeAppUI() {
    console.log("UI 초기화를 시작합니다...");
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('transaction-date').value = today;
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    document.getElementById('invoice-start-date').value = firstDayOfMonth;
    document.getElementById('invoice-end-date').value = today;
    bindEventListeners();
    ic_addItemRow();
    console.log("UI 초기화 완료.");
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
    const record = {
        type: document.getElementById('transaction-type').value,
        date: document.getElementById('transaction-date').value,
        brand: document.getElementById('tran-brand').value.trim(),
        lot: document.getElementById('tran-lot').value.trim(),
        company: document.getElementById('transaction-company').value.trim(),
        weight: Number(document.getElementById('transaction-weight').value) || 0,
        unitPrice: Number(document.getElementById('transaction-unit-price').value) || 0,
        otherCosts: Number(document.getElementById('transaction-other-costs').value) || 0,
        category: document.getElementById('tran-category').value.trim(),
        spec: document.getElementById('tran-spec').value.trim(),
        notes: document.getElementById('transaction-notes').value.trim(),
        destination: document.getElementById('transaction-destination').value.trim(),
        specialNotes: document.getElementById('transaction-special-notes').value.trim()
    };

    if (!record.date || !record.brand || !record.lot || record.weight <= 0 || !record.company) {
        return alert('필수 항목(날짜, 브랜드, LOT, 중량, 업체)을 모두 입력해주세요.');
    }

    try {
        if (isEdit && editingTransactionId) {
            console.log("--- 진단 시작: 'processTransaction' 함수가 수정 저장을 시도합니다.");
            console.log(`--- 진단: Firestore에 수정을 요청할 ID는 [ ${editingTransactionId} ] 입니다.`);
            console.log("--- 진단: '수정 저장'을 누르는 순간의 로컬 ID 목록:", transactions.map(t => t.id));

            const docRef = transactionsCollection.doc(editingTransactionId);
            const doc = await docRef.get();

            if (!doc.exists) {
                alert('오류: 수정하려는 데이터가 데이터베이스에 존재하지 않습니다. 페이지를 새로고침 후 다시 시도해주세요.');
                console.error("수정 실패: 문서 ID를 찾을 수 없음", editingTransactionId);
                cancelTransactionEdit();
                return;
            }

            await docRef.update(record);
            alert('거래내역이 성공적으로 수정되었습니다.');
        } else {
            await transactionsCollection.add(record);
            alert('입출고 내역이 성공적으로 등록되었습니다.');
        }
        cancelTransactionEdit();
    } catch (error) {
        console.error("데이터 저장/수정 오류:", error, "시도된 객체:", record);
        alert(`데이터를 처리하는 중 오류가 발생했습니다. 다시 시도해주세요.\n\n오류: ${error.message}`);
    }
}

async function deleteSelectedTransactions() {
    const selectedIds = Array.from(document.querySelectorAll('.transaction-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) return alert('삭제할 항목을 선택하세요.');
    if (!confirm(`선택된 ${selectedIds.length}개의 거래를 삭제하시겠습니까?`)) return;

    try {
        if (editingTransactionId && selectedIds.includes(editingTransactionId)) {
            console.log('수정 중인 항목이 삭제되었습니다. 수정 모드를 취소합니다.');
            cancelTransactionEdit();
        }

        const batch = db.batch();
        selectedIds.forEach(id => batch.delete(transactionsCollection.doc(id)));
        await batch.commit();
        alert(`${selectedIds.length}개의 거래가 삭제되었습니다.`);
    } catch (error) {
        console.error("데이터 삭제 오류:", error);
        alert("데이터를 삭제하는 중 오류가 발생했습니다.");
    }
}

// ================== 4. UI 및 비즈니스 로직 ==================

function updateAll() {
    recalculateInventory(); 
    applyFiltersAndRender(); 
    updateDatalists();
    generateSalesReport(); 
}

function showTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.querySelector(`[onclick="showTab('${tabName}')"]`).classList.add('active');
    document.getElementById('invoice-wrapper').style.display = 'none';
    document.getElementById('bill-wrapper').style.display = 'none';
    document.getElementById(tabName).classList.add('active');
    cancelTransactionEdit();
    ic_clearForm();
    if(tabName === 'sales-report') generateSalesReport();
}

function applyFiltersAndRender() {
    const invFilters = {
        brand: document.getElementById('filter-inv-brand').value.toLowerCase(),
        category: document.getElementById('filter-inv-category').value.toLowerCase(),
        spec: document.getElementById('filter-inv-spec').value.toLowerCase(),
        lot: document.getElementById('filter-inv-lot').value.toLowerCase()
    };
    const filteredInventory = inventory.filter(i => 
        i.brand.toLowerCase().includes(invFilters.brand) &&
        (i.category || '').toLowerCase().includes(invFilters.category) &&
        (i.spec || '').toLowerCase().includes(invFilters.spec) &&
        i.lot.toLowerCase().includes(invFilters.lot)
    );
    updateInventoryTable(filteredInventory);

    const tranFilters = {
        type: document.getElementById('filter-tran-type').value,
        month: document.getElementById('filter-tran-month').value,
        brand: document.getElementById('filter-tran-brand').value.toLowerCase(),
        category: document.getElementById('filter-tran-category').value.toLowerCase(),
        spec: document.getElementById('filter-tran-spec').value.toLowerCase(),
        lot: document.getElementById('filter-tran-lot').value.toLowerCase(),
        company: document.getElementById('filter-tran-company').value.toLowerCase()
    };
    const filteredTransactions = transactions.filter(t => 
        (!tranFilters.type || t.type === tranFilters.type) &&
        (!tranFilters.month || t.date.startsWith(tranFilters.month)) &&
        (t.brand?.toLowerCase().includes(tranFilters.brand)) &&
        (t.category?.toLowerCase().includes(tranFilters.category)) &&
        (t.spec?.toLowerCase().includes(tranFilters.spec)) &&
        (t.lot?.toLowerCase().includes(tranFilters.lot)) && 
        (t.company?.toLowerCase().includes(tranFilters.company))
    );
    updateTransactionTable(filteredTransactions);
}

function updateTransactionTable(transactionsToDisplay) {
    const tbody = document.getElementById('transaction-tbody');
    tbody.innerHTML = '';
    transactionsToDisplay.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(t => {
        const row = tbody.insertRow();
        const weight = parseFloat(t.weight) || 0;
        const unitPrice = parseFloat(t.unitPrice) || 0;
        const otherCosts = parseFloat(t.otherCosts) || 0;
        const amount = weight * unitPrice;

        row.innerHTML = `
            <td><input type="checkbox" class="transaction-checkbox" value="${t.id}"></td>
            <td>${t.type}</td><td>${t.date}</td><td>${t.brand || ''}</td>
            <td>${t.category || ''}</td><td>${t.spec || ''}</td><td>${t.lot || ''}</td>
            <td>${weight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${unitPrice.toLocaleString('en-US')}</td>
            <td>${amount.toLocaleString('en-US')}</td>
            <td>${(t.type === '출고' ? otherCosts : 0).toLocaleString('en-US')}</td>
            <td>${t.company}</td><td>${t.notes || ''}</td><td>${t.destination || ''}</td><td>${t.specialNotes || ''}</td>`;
    });
    // Update totals, etc.
}

function editSelectedTransaction() {
    console.log("--- 진단 시작: 'editSelectedTransaction' 함수 실행 ---");
    const selectedIds = Array.from(document.querySelectorAll('.transaction-checkbox:checked')).map(cb => cb.value);
    
    if (selectedIds.length !== 1) {
        console.log("--- 진단: 수정할 항목이 1개가 아니므로 중단.");
        return alert('수정할 항목을 하나만 선택하세요.');
    }
    
    const transactionId = selectedIds[0];
    console.log(`--- 진단: 사용자가 체크박스에서 선택한 ID는 [ ${transactionId} ] 입니다.`);

    const transaction = transactions.find(t => t.id === transactionId);

    if (!transaction) {
        console.error("--- 심각한 오류: 화면의 체크박스 ID가 로컬 데이터 배열('transactions')에 존재하지 않습니다! UI와 데이터가 동기화되지 않았습니다.");
        console.log("--- 진단: 현재 로컬 배열에 있는 모든 ID 목록:", transactions.map(t => t.id));
        alert("치명적인 오류: UI 데이터가 일치하지 않습니다. 페이지를 강력 새로고침(Ctrl+Shift+R)하고 다시 시도해주세요.");
        return;
    }

    editingTransactionId = transaction.id;
    console.log(`--- 진단: 'editingTransactionId' 변수가 [ ${editingTransactionId} ] (으)로 설정되었습니다.`);
    
    document.getElementById('transaction-type').value = transaction.type;
    document.getElementById('transaction-date').value = transaction.date;
    document.getElementById('tran-brand').value = transaction.brand;
    document.getElementById('tran-lot').value = transaction.lot;
    document.getElementById('tran-category').value = transaction.category || '';
    document.getElementById('tran-spec').value = transaction.spec || '';
    document.getElementById('transaction-weight').value = transaction.weight;
    document.getElementById('transaction-unit-price').value = transaction.unitPrice || '';
    document.getElementById('transaction-company').value = transaction.company;
    document.getElementById('transaction-notes').value = transaction.notes || '';
    document.getElementById('transaction-destination').value = transaction.destination || '';
    document.getElementById('transaction-special-notes').value = transaction.specialNotes || '';
    document.getElementById('transaction-other-costs').value = transaction.otherCosts || '';
    
    toggleOtherCostsField();
    document.getElementById('transaction-form-title').innerText = '입출고 수정';
    document.getElementById('transaction-form-buttons').innerHTML = `
        <button class="btn btn-success" onclick="processTransaction(true)">수정 저장</button>
        <button class="btn btn-secondary" onclick="cancelTransactionEdit()">취소</button>`;
    window.scrollTo(0, 0);
}

function cancelTransactionEdit() {
    editingTransactionId = null;
    document.getElementById('transaction-form-title').innerText = '입출고 등록';
    document.getElementById('transaction-form-buttons').innerHTML = `
        <button class="btn btn-primary" onclick="processTransaction(false)">입출고 등록</button>
        <button class="btn btn-warning" onclick="openBulkUploadModal()">대량 입출고 등록</button>`;
    
    const form = document.querySelector('#transaction .section .input-group');
    if (form) {
        Array.from(form.querySelectorAll('input, select')).forEach(input => {
            if (input.type === 'select-one') input.selectedIndex = 0;
            else if (input.id !== 'transaction-date') input.value = '';
        });
    }
    document.getElementById('transaction-date').value = new Date().toISOString().slice(0, 10);
    toggleOtherCostsField();
}

// (이 밑으로 나머지 함수들은 제공된 파일과 동일하게 유지됩니다)
// ... recalculateInventory, updateInventoryTable, etc ...
// ... 모든 헬퍼 함수 및 ic_ 함수들 ...
// ... 백업/복원 함수들 ...
// ... 청구서/거래명세서 함수들 ...

// 이 아래는 편의상 생략되었지만, 실제 파일에는 모든 함수가 포함되어야 합니다.
// 제공된 `app (4).js` 파일의 나머지 부분을 이 아래에 그대로 유지하시면 됩니다.

// ================== 5. HTML onclick과 함수 연결 ==================
window.showTab = showTab;
window.toggleOtherCostsField = toggleOtherCostsField;
window.addTransaction = () => processTransaction(false);
window.openBulkUploadModal = openBulkUploadModal;
window.resetTransactionFilters = resetTransactionFilters;
window.editSelectedTransaction = editSelectedTransaction;
window.deleteSelectedTransactions = deleteSelectedTransactions;
window.exportTransactionCSV = exportTransactionCSV;
window.toggleAllCheckboxes = toggleAllCheckboxes;
// ... 이하 모든 window 객체 할당 ...
window.cancelTransactionEdit = cancelTransactionEdit;


// (이하 생략 - 원본 파일의 나머지 코드를 여기에 유지)
// ... 나머지 모든 함수와 window 객체 할당 ...
