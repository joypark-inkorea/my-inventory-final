// ************* 여길 채워주세요! *************
// Firebase 콘솔에서 확인한 내 프로젝트의 설정 정보를 붙여넣으세요.
const firebaseConfig = {
apiKey: "AIzaSyDA0BNmhnr37KqyI7oj766TwB8FrejsRzo",
  authDomain: "my-inventory-final.firebaseapp.com",
  projectId: "my-inventory-final",
  storageBucket: "my-inventory-final.firebasestorage.app",
  messagingSenderId: "740246970535",
  appId: "1:740246970535:web:f7738b92a6097671f67b82",
  measurementId: "G-4ZF63VWX6Z"

};
// ********************************************

// Firebase 앱 초기화
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Firestore 컬렉션 참조
const transactionsCollection = db.collection('transactions');
const importCostSheetsCollection = db.collection('importCostSheets');

// 전역 변수 (데이터를 담을 배열)
let inventory = [];
let transactions = [];
let ic_costSheets = [];
let editingTransactionId = null;
let ic_editingId = null;

// ================== 인증 및 초기화 ==================

// 로그인 상태 감지
auth.onAuthStateChanged(user => {
    if (user) {
        // 사용자가 로그인한 경우, 데이터 로드 시작
        console.log('로그인 된 사용자:', user.email);
        loadAllData();
    } else {
        // 로그인하지 않은 경우, 로그인 페이지로 리디렉션
        console.log('로그인 필요');
        window.location.href = 'login.html';
    }
});

// 로그아웃 버튼 이벤트
document.getElementById('logout-btn').addEventListener('click', () => {
    auth.signOut().then(() => {
        console.log('로그아웃 성공');
        window.location.href = 'login.html';
    }).catch(error => {
        console.error('로그아웃 실패:', error);
    });
});


// 모든 데이터를 Firestore에서 비동기적으로 로드하는 함수
async function loadAllData() {
    try {
        // 입출고 내역 로드
        const tranSnapshot = await transactionsCollection.get();
        transactions = tranSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // 수입원가 내역 로드
        const costSheetSnapshot = await importCostSheetsCollection.get();
        ic_costSheets = costSheetSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log("데이터 로드 완료. 입출고:", transactions.length, "건, 수입원가:", ic_costSheets.length, "건");

        // 데이터 로드 후 UI 업데이트
        initializeUI();

    } catch (error) {
        console.error("데이터 로딩 중 오류 발생:", error);
        alert("데이터를 불러오는 데 실패했습니다. 페이지를 새로고침 해주세요.");
    }
}

// UI 초기 설정 함수
function initializeUI() {
    updateAll(); // 재고 계산 및 화면 렌더링
    updateDatalists();
    ic_renderList();
    ic_addItemRow();

    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('transaction-date').value = today;
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    document.getElementById('invoice-start-date').value = firstDayOfMonth;
    document.getElementById('invoice-end-date').value = today;

    // 이벤트 리스너 바인딩
    bindEventListeners();
}

// 이벤트 리스너를 한 곳에서 관리
function bindEventListeners() {
    // 필터 입력 이벤트
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
    
    document.getElementById('tran-brand').addEventListener('blur', autoFillItemDetails);
    document.getElementById('tran-lot').addEventListener('blur', autoFillItemDetails);
}


// ================== 핵심 로직 (Firebase 연동) ==================

// [수정됨] 입출고 등록/수정 함수
async function processTransaction(isEdit = false) {
    const weight = parseFloat(document.getElementById('transaction-weight').value) || 0;
    const transactionRecord = {
        type: document.getElementById('transaction-type').value,
        date: document.getElementById('transaction-date').value,
        brand: document.getElementById('tran-brand').value.trim(),
        lot: document.getElementById('tran-lot').value.trim(),
        weight: weight,
        unitPrice: parseFloat(document.getElementById('transaction-unit-price').value) || 0,
        category: document.getElementById('tran-category').value.trim(),
        spec: document.getElementById('tran-spec').value.trim(),
        company: document.getElementById('transaction-company').value.trim(),
        notes: document.getElementById('transaction-notes').value.trim(),
        destination: document.getElementById('transaction-destination').value.trim(),
        specialNotes: document.getElementById('transaction-special-notes').value.trim(),
        otherCosts: parseFloat(document.getElementById('transaction-other-costs').value) || 0
    };

    if (!transactionRecord.date || !transactionRecord.brand || !transactionRecord.lot || transactionRecord.weight <= 0 || !transactionRecord.company) {
        alert('필수 항목(날짜, 브랜드, LOT, 중량, 업체)을 모두 입력해주세요.');
        return;
    }

    try {
        if (isEdit) {
            // 수정 모드
            await transactionsCollection.doc(editingTransactionId).update(transactionRecord);
            // 로컬 데이터도 업데이트
            const index = transactions.findIndex(t => t.id === editingTransactionId);
            if (index > -1) transactions[index] = { id: editingTransactionId, ...transactionRecord };
            alert('거래내역이 수정되었습니다.');
        } else {
            // 등록 모드
            const docRef = await transactionsCollection.add(transactionRecord);
            // 로컬 데이터에도 추가 (Firestore에서 부여한 id 포함)
            transactions.push({ id: docRef.id, ...transactionRecord });
            alert('입출고 내역이 등록되었습니다.');
        }
        updateAll();
        cancelTransactionEdit();
    } catch (error) {
        console.error("데이터 저장 오류:", error);
        alert("데이터를 저장하는 중 오류가 발생했습니다.");
    }
}

// [수정됨] 선택된 거래내역 삭제 함수
async function deleteSelectedTransactions() {
    const selectedIds = getSelectedIds('transaction-checkbox');
    if (selectedIds.length === 0) {
        alert('삭제할 항목을 선택하세요.');
        return;
    }
    if (confirm(`선택된 ${selectedIds.length}개의 거래를 삭제하시겠습니까?`)) {
        try {
            // Firestore에서 일괄 삭제 (Batch)
            const batch = db.batch();
            selectedIds.forEach(id => {
                batch.delete(transactionsCollection.doc(id));
            });
            await batch.commit();

            // 로컬 데이터에서 삭제
            transactions = transactions.filter(t => !selectedIds.includes(t.id));
            
            updateAll();
            alert(`${selectedIds.length}개의 거래가 삭제되었습니다.`);
        } catch (error) {
            console.error("데이터 삭제 오류:", error);
            alert("데이터를 삭제하는 중 오류가 발생했습니다.");
        }
    }
}


// [수정됨] 수입원가 정산서 등록/수정 함수
async function ic_processCostSheet(isEdit) {
    // ... 기존 ic_processCostSheet 로직에서 데이터 수집 부분은 동일 ...
    // (데이터 유효성 검사 등)
    // ...
    
    // Firestore에 저장할 데이터 객체 생성
    const sheetData = { /* 폼에서 읽어온 데이터 */ };

    try {
        if (isEdit) {
            await importCostSheetsCollection.doc(ic_editingId).update(sheetData);
            const index = ic_costSheets.findIndex(s => s.id === ic_editingId);
            if (index > -1) ic_costSheets[index] = { ...sheetData, id: ic_editingId };
            alert('수정되었습니다.');
        } else {
            const docRef = await importCostSheetsCollection.add(sheetData);
            sheetData.id = docRef.id;
            ic_costSheets.push(sheetData);
            alert('등록되었습니다.');
        }
        ic_renderList();
        ic_clearForm();
    } catch (error) {
        console.error("수입원가 정산서 저장 오류:", error);
        alert("정산서를 저장하는 중 오류가 발생했습니다.");
    }
}

// [수정됨] 수입원가 정산서 삭제 함수
async function ic_deleteSelectedSheets() {
    const selectedIds = Array.from(document.querySelectorAll('#cost-list-table .sheet-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) { alert('삭제할 항목을 선택하세요.'); return; }
    if (confirm(`선택된 ${selectedIds.length}개의 정산 내역을 삭제하시겠습니까?`)) {
        try {
            const batch = db.batch();
            selectedIds.forEach(id => {
                batch.delete(importCostSheetsCollection.doc(id));
            });
            await batch.commit();

            ic_costSheets = ic_costSheets.filter(s => !selectedIds.includes(s.id));
            ic_renderList();
            alert('정산 내역이 삭제되었습니다.');
        } catch (error) {
            console.error("정산서 삭제 오류:", error);
            alert("정산 내역을 삭제하는 중 오류가 발생했습니다.");
        }
    }
}

// ================== 기존 UI/헬퍼 함수들 (대부분 그대로 사용) ==================
// 참고: 아래 함수들은 Firebase와 직접 통신하지 않으므로, 대부분 수정 없이 사용 가능합니다.
// 단, 전역 변수인 transactions, ic_costSheets 등을 직접 참조합니다.
// 전역 함수로 만들기 위해 앞에 `window.`를 붙여 HTML의 onclick에서 호출할 수 있게 합니다.

window.showTab = function(tabName) {
    // ... 기존 코드와 동일 ...
}

// ... (여기에 기존 HTML 파일의 <script> 태그 안에 있던 모든 함수를 복사해 붙여넣습니다.) ...
// ... (예: recalculateInventory, updateInventoryTable, generateInvoice, 등등) ...

// [중요] 단, 아래 함수들은 수정 또는 제거가 필요합니다.
// 1. saveData(), loadData() -> Firebase로 대체되었으므로 제거합니다.
// 2. backupDataToJson(), restoreDataFromJson(), loadBackupFile() -> Firebase가 실시간 백업 역할을 하므로 제거합니다.
// 3. addTransaction(), deleteSelectedTransactions() 등 데이터 변경 함수들은
//    위에 작성한 async 버전으로 대체해야 합니다. (기존 동기 코드는 삭제)

// 예시: 기존 코드 붙여넣기
window.recalculateInventory = function() { /* ... 기존 로직 ... */ }
window.applyFiltersAndRender = function() { /* ... 기존 로직 ... */ }
window.updateInventoryTable = function(items) { /* ... 기존 로직 ... */ }
// ... 나머지 모든 함수 ...

// [중요] HTML의 onclick에서 호출하는 함수들은 window 객체에 할당해야 합니다.
window.addTransaction = () => processTransaction(false);
window.saveTransaction = () => processTransaction(true);
window.editSelectedTransaction = () => { /* ... 기존 로직 ... */ }
window.deleteSelectedTransactions = deleteSelectedTransactions;
// ... 이런 식으로 모든 onclick 핸들러를 연결합니다.
