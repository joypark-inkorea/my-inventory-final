
// **********************************

// Firebase 앱 초기화
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Firestore 컬렉션 참조
const transactionsCollection = db.collection('transactions');
const importCostSheetsCollection = db.collection('importCostSheets');
const salesCollection = db.collection('sales');
const remittancesCollection = db.collection('remittances');
// [추가]
const purchasesCollection = db.collection('purchases');
// [아래 1줄 추가] (기존 memosCollection은 지웠습니다)
const expenditureMemosCollection = db.collection('expenditureMemos'); 

// 전역 변수
let inventory = [];
let transactions = [];
let sales = [];
let remittances = [];
// [추가]
let purchases = [];
// [아래 1줄 추가]
let expenditureMemos = {}; // 월별 간단 메모 데이터 (예: {'2025-10': ['메모1', '메모2']})
let ic_costSheets = [];
let editingTransactionId = null;
let editingSaleId = null;
let editingRemittanceId = null;
let ic_editingId = null;
// [추가]
let editingPurchaseId = null;
// START: CSV 전역 변수 추가
let salesCsvData = null; // 매출 CSV 데이터 저장용
let remitCsvData = null; // 해외송금 CSV 데이터 저장용
//[추가]
let purchaseCsvData = null; // 매입 CSV 데이터 저장용
// END: CSV 전역 변수 추가
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

/**
 * 날짜 문자열(YYYY-MM-DD)을 짧은 형식(YY/M/D)으로 변환합니다.
 * @param {string} dateString (예: "2025-02-03")
 * @returns {string} (예: "25/2/3")
 */
function formatShortDate(dateString) {
    if (!dateString) return ''; // 날짜가 없으면 빈칸 반환
    try {
        const date = new Date(dateString);
        // getFullYear()는 2025, slice(-2)로 뒤의 2자리(25)만 가져옵니다.
        const year = date.getFullYear().toString().slice(-2);
        // getMonth()는 0부터 시작하므로 +1 해줍니다. (예: 1월 -> 0)
        const month = date.getMonth() + 1;
        // getDate()는 날짜를 반환합니다.
        const day = date.getDate();
        
        return `${year}/${month}/${day}`;
    } catch (e) {
        // 혹시 날짜 형식이 잘못된 경우, 원본을 그대로 반환
        return dateString;
    }
}

/**
 * 문자열에서 숫자만 추출하여 소수점으로 변환합니다. 쉼표 등을 제거합니다.
 * @param {string|number} value - 변환할 값
 * @returns {number} 변환된 숫자 (실패 시 0)
 */
function ic_pFloat(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        // 숫자, 소수점, 마이너스 부호 외 모든 문자 제거
        const cleaned = value.replace(/[^0-9.-]/g, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    }
    return 0; // 그 외의 경우 0 반환
}

// --- loadAllDataFromFirebase 함수 수정 ---
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
        transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return { ...data, id: doc.id, product: data.product || data.category || '' };
        });
        console.log(`입출고 데이터 실시간 업데이트됨. 총 ${transactions.length}건`);
        updateAll();
        // updateDashboard(); // [삭제] 2)
    }, error => console.error("입출고 내역 실시간 동기화 오류:", error));

    importCostSheetsCollection.onSnapshot(snapshot => {
        ic_costSheets = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        console.log(`수입원가 데이터 실시간 업데이트됨. 총 ${ic_costSheets.length}건`);
        ic_renderList();
    }, error => console.error("수입원가 정산서 실시간 동기화 오류:", error));

    salesCollection.onSnapshot(snapshot => {
        sales = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        console.log(`매출 데이터 실시간 업데이트됨. 총 ${sales.length}건`);
        applySalesFiltersAndRender();
        // generateSalesReport(); // [삭제] 2)
        // updateDashboard(); // [삭제] 2)
    }, error => console.error("매출 내역 실시간 동기화 오류:", error));

    remittancesCollection.onSnapshot(snapshot => {
    remittances = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    // [수정] 송금 데이터 업데이트 로그 및 송금 테이블 갱신 함수 호출로 변경
    console.log(`해외송금 데이터 실시간 업데이트됨. 총 ${remittances.length}건`); 
    applyRemittanceFiltersAndRender(); // <-- 함수 이름 변경
}, error => console.error("해외송금 내역 실시간 동기화 오류:", error)); // <-- 에러 메시지도 변경

// [추가 START] 현황판 탭의 '월별 간단 메모' 실시간 리스너
expenditureMemosCollection.onSnapshot(snapshot => {
    const newMemos = {};
    snapshot.docs.forEach(doc => {
        // 문서 ID가 'YYYY-MM' (예: '2025-10')
        // 문서 내용이 { notes: ['메모1', '메모2'] } 형태라고 가정
        newMemos[doc.id] = doc.data().notes || [];
    });
    expenditureMemos = newMemos;
    console.log(`현황판 월별 메모 데이터 실시간 업데이트됨.`);
    // 현재 '중요 메모장' 탭이 활성화 상태라면 메모 목록 즉시 갱신
    if (document.getElementById('memo')?.classList.contains('active')) {
        renderExpenditureMemo();
    }
}, error => console.error("현황판 월별 메모 실시간 동기화 오류:", error));
// [추가 END]

    initializeAppUI();
}

// --- initializeAppUI 함수 수정 ---



function initializeAppUI() {
    console.log("UI 초기화를 시작합니다...");
    const today = new Date().toISOString().slice(0, 10);
// [수정] 'purchase-date', 'memo-date' 추가
    ['transaction-date', 'sales-date', 'remit-date', 'purchase-date', 'memo-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = today;
    });    

    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    document.getElementById('invoice-start-date').value = firstDayOfMonth;
    document.getElementById('invoice-end-date').value = today;
    
   bindEventListeners();
    ic_addItemRow();
    console.log("UI 초기화 완료.");

// [아래 1줄 추가]
initializeExpenditureTabFilters(); 
}

// --- bindEventListeners 함수 수정 ---
function bindEventListeners() {

    ['filter-inv-brand', 'filter-inv-product', 'filter-inv-spec', 'filter-inv-lot', 
     'filter-tran-type', 'filter-tran-month', 'filter-tran-brand', 'filter-tran-product', 
     'filter-tran-spec', 'filter-tran-lot', 'filter-tran-company']
    .forEach(id => document.getElementById(id)?.addEventListener('input', applyFiltersAndRender));

    ['filter-sales-start-month', 'filter-sales-end-month', 'filter-sales-list-company', 'filter-sales-list-brand', 'filter-sales-list-item-category', 'filter-sales-list-product', 'filter-sales-list-spec']
    .forEach(id => document.getElementById(id)?.addEventListener('input', applySalesFiltersAndRender));

    ['filter-remit-start-month', 'filter-remit-end-month', 'filter-remit-company', 'filter-remit-brand', 'filter-remit-item-category', 'filter-remit-product', 'filter-remit-spec']
    .forEach(id => document.getElementById(id)?.addEventListener('input', applyRemittanceFiltersAndRender));

// [추가 START] '매입' 및 '메모' 리스너
    ['filter-purchase-start-month', 'filter-purchase-end-month', 'filter-purchase-list-company', 'filter-purchase-list-brand', 'filter-purchase-list-item-category', 'filter-purchase-list-product', 'filter-purchase-list-spec']
    .forEach(id => document.getElementById(id)?.addEventListener('input', applyPurchaseFiltersAndRender));
    // [추가 END]

    document.getElementById('tran-brand').addEventListener('blur', autoFillItemDetails);
    document.getElementById('tran-lot').addEventListener('blur', autoFillItemDetails);

// START: CSV 파일 입력 이벤트 리스너 추가
const salesCsvEl = document.getElementById('sales-csv-file');
if (salesCsvEl) salesCsvEl.addEventListener('change', handleSalesCsvUpload);
const remitCsvEl = document.getElementById('remit-csv-file');
if (remitCsvEl) remitCsvEl.addEventListener('change', handleRemittanceCsvUpload);

// [추가 START] '매입' CSV 및 '메모' 버튼 리스너
    const purchaseCsvEl = document.getElementById('purchase-csv-file');
    if (purchaseCsvEl) purchaseCsvEl.addEventListener('change', handlePurchaseCsvUpload);

    // [추가 END]
// END: CSV 파일 입력 이벤트 리스너 추가
}

// ================== 2. Firebase 데이터 처리 (CRUD) ==================

// --- 2.1 입출고 (Transaction) ---
// [수정] 1) 판가/원가/총매출/총마진 적용
async function processTransaction(isEdit) {
    const record = {
        type: document.getElementById('transaction-type').value,
        date: document.getElementById('transaction-date').value,
        brand: document.getElementById('tran-brand').value.trim(),
        lot: document.getElementById('tran-lot').value.trim(),
        company: document.getElementById('transaction-company').value.trim(),
        weight: ic_pFloat(document.getElementById('transaction-weight').value),
        
        // [수정] '단가', '기타비용' 삭제 -> '판가', '원가', '총매출', '총마진' 추가
        sellingPrice: ic_pFloat(document.getElementById('transaction-selling-price').value),
        costPrice: ic_pFloat(document.getElementById('transaction-cost-price').value),
        totalSales: ic_pFloat(document.getElementById('transaction-total-sales').value),
        totalMargin: ic_pFloat(document.getElementById('transaction-total-margin').value),
        
        // [수정] 기존 필드들
        product: document.getElementById('tran-product').value.trim(),
        spec: document.getElementById('tran-spec').value.trim(),      
        notes: document.getElementById('transaction-notes').value.trim(),
        destination: document.getElementById('transaction-destination').value.trim(),
        specialNotes: document.getElementById('transaction-special-notes').value.trim()
    };

    // [수정] 유효성 검사 (weight > 0 만 체크)
    if (!record.date || !record.brand || !record.lot || record.weight <= 0 || !record.company) {
        return alert('필수 항목(날짜, 브랜드, LOT, 중량, 업체)을 모두 입력해주세요.');
    }

    try {
        if (isEdit && editingTransactionId) {
            await transactionsCollection.doc(editingTransactionId).update(record);
            alert('거래내역이 성공적으로 수정되었습니다.');
        } else {
            await transactionsCollection.add(record);
            alert('입출고 내역이 성공적으로 등록되었습니다.');
        }
        cancelTransactionEdit(); // 폼 초기화
    } catch (error) {
        console.error("데이터 저장/수정 오류:", error);
        alert(`데이터를 처리하는 중 오류가 발생했습니다: ${error.message}`);
    }
}

// [수정] 1) processTransaction에서 변경된 record 객체 형식을 지원
async function processBulkTransactions(records) {
    const batch = db.batch();
    records.forEach(record => {
        // 유효성 검사는 processBulkUpload에서 이미 수행
        if (!record.date || !record.brand || !record.lot || record.weight <= 0 || !record.company) return;
        
        // record 객체는 이미 sellingPrice, costPrice, totalSales, totalMargin을 포함하고 있음
        const docRef = transactionsCollection.doc();
        batch.set(docRef, record);
    });
    try {
        await batch.commit();
        alert(`${records.length}건의 데이터가 성공적으로 등록되었습니다.`);
    } catch (error) {
        console.error("대량 등록 오류:", error);
        alert(`대량 등록 중 오류 발생: ${error.message}`);
    }
}

async function deleteSelectedTransactions() {
    const selectedIds = Array.from(document.querySelectorAll('.transaction-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) return alert('삭제할 항목을 선택하세요.');
    if (!confirm(`선택된 ${selectedIds.length}개의 거래를 삭제하시겠습니까?`)) return;
    try {
        if (editingTransactionId && selectedIds.includes(editingTransactionId)) {
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

// --- 2.2 수입원가 (Import Cost) ---
async function ic_processCostSheet(isEdit) {
    const sheetData = {
        shipper: document.getElementById('form-shipper').value.trim(),
        terms: document.getElementById('form-terms').value.trim(),
        origin: document.getElementById('form-origin').value.trim(),
        method: document.getElementById('form-method').value.trim(),
        etd: document.getElementById('form-etd').value.trim(),
        eta: document.getElementById('form-eta').value.trim(),
        cbm: document.getElementById('form-cbm').value.trim(),
        packing: document.getElementById('form-packing').value.trim(),
        exchangeRate: document.getElementById('form-exchange-rate').value,
        shippingFee: document.getElementById('form-shipping-fee').value,
        tariffRate: document.getElementById('form-tariff-rate').value,
        tariffAmount: document.getElementById('form-tariff-amount').value,
        vatAmount: document.getElementById('form-vat-amount').value,
        forwarderFee1: document.getElementById('form-forwarder-fee1').value,
        forwarderFee2: document.getElementById('form-forwarder-fee2').value,
        forwarderFee3: document.getElementById('form-forwarder-fee3').value,
        items: []
    };
    document.querySelectorAll('#item-tbody tr').forEach(row => {
        const item = {
            name: row.querySelector('.item-name').value.trim(),
            lot: row.querySelector('.item-lot').value.trim(),
            qty: ic_pFloat(row.querySelector('.item-qty').value),
            unit: row.querySelector('.item-unit').value.trim(),
            price: ic_pFloat(row.querySelector('.item-price').value),
        };
        if (item.name && item.qty > 0) sheetData.items.push(item);
    });
    if (!sheetData.shipper || !sheetData.etd || ic_pFloat(sheetData.exchangeRate) === 0 || sheetData.items.length === 0) {
        return alert('필수 항목(Shipper, ETD, 적용환율, 품목 정보)을 모두 입력해주세요.');
    }
    let totalInvoiceValue = sheetData.items.reduce((sum, item) => sum + (item.qty * item.price), 0);
    const exchangeRate = ic_pFloat(sheetData.exchangeRate);
    const invoiceKrw = totalInvoiceValue * exchangeRate;
    const totalMaterialCost = invoiceKrw + ic_pFloat(sheetData.shippingFee);
    const tariffCost = ic_pFloat(sheetData.tariffAmount);
    const totalForwarderFee = ic_pFloat(sheetData.forwarderFee1) + ic_pFloat(sheetData.forwarderFee2) + ic_pFloat(sheetData.forwarderFee3);
    const grandTotal = totalMaterialCost + tariffCost + totalForwarderFee;
    sheetData.items.forEach(item => {
        item.unitCost = (totalInvoiceValue > 0 && item.qty > 0) ? (grandTotal * ((item.qty * item.price) / totalInvoiceValue)) / item.qty : 0;
    });
    try {
        if (isEdit && ic_editingId) {
            await importCostSheetsCollection.doc(ic_editingId).update(sheetData);
            alert('수정되었습니다.');
        } else {
            await importCostSheetsCollection.add(sheetData);
            alert('등록되었습니다.');
        }
        ic_clearForm();
    } catch (error) {
        console.error("정산서 저장 오류:", error);
        alert("정산서를 저장하는 중 오류가 발생했습니다.");
    }
}
async function ic_deleteSelectedSheets() {
    const selectedIds = Array.from(document.querySelectorAll('.sheet-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) return alert('삭제할 항목을 선택하세요.');
    if (!confirm(`선택된 ${selectedIds.length}개의 정산 내역을 삭제하시겠습니까?`)) return;
    try {
        const batch = db.batch();
        selectedIds.forEach(id => batch.delete(importCostSheetsCollection.doc(id)));
        await batch.commit();
        alert(`${selectedIds.length}개의 정산 내역이 삭제되었습니다.`);
    } catch (error) {
        console.error("정산서 삭제 오류:", error);
        alert("정산서를 삭제하는 중 오류가 발생했습니다.");
    }
}

// --- 2.3 신규: 매출 (Sales) ---
async function processSale(isEdit) {
    const record = {
        date: document.getElementById('sales-date').value,
        company: document.getElementById('sales-company').value.trim(),
        brand: document.getElementById('sales-brand').value.trim(),
        itemCategory: document.getElementById('sales-item-category').value,
        product: document.getElementById('sales-product').value.trim(),
        spec: document.getElementById('sales-spec').value.trim(),
        quantity: Number(document.getElementById('sales-quantity').value) || 0,
        unit: document.getElementById('sales-unit').value,
        sellingPrice: Number(document.getElementById('sales-selling-price').value) || 0,
        costPrice: Number(document.getElementById('sales-cost-price').value) || 0,
        totalSales: Number(document.getElementById('sales-total-sales').value) || 0,
        totalMargin: Number(document.getElementById('sales-total-margin').value) || 0,
        notes: document.getElementById('sales-notes').value.trim()
    };

if (!record.date || !record.company || !record.brand || record.quantity <= 0) {
        return alert('필수 항목(날짜, 업체, 브랜드, 수량, 판가)을 모두 입력해주세요.');
}
    
    try {
        if (isEdit && editingSaleId) {
            await salesCollection.doc(editingSaleId).update(record);
            alert('매출 내역이 성공적으로 수정되었습니다.');
        } else {
            await salesCollection.add(record);
            alert('매출 내역이 성공적으로 등록되었습니다.');
        }
        cancelSaleEdit();
    } catch (error) {
        console.error("매출 데이터 저장/수정 오류:", error);
        alert(`매출 데이터를 처리하는 중 오류가 발생했습니다: ${error.message}`);
    }
}

async function deleteSelectedSales() {
    const selectedIds = Array.from(document.querySelectorAll('.sales-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) return alert('삭제할 항목을 선택하세요.');
    if (!confirm(`선택된 ${selectedIds.length}개의 매출을 삭제하시겠습니까?`)) return;
    try {
        if (editingSaleId && selectedIds.includes(editingSaleId)) {
            cancelSaleEdit();
        }
        const batch = db.batch();
        selectedIds.forEach(id => batch.delete(salesCollection.doc(id)));
        await batch.commit();
        alert(`${selectedIds.length}개의 매출이 삭제되었습니다.`);
    } catch (error) {
        console.error("매출 데이터 삭제 오류:", error);
        alert("매출 데이터를 삭제하는 중 오류가 발생했습니다.");
    }
}

// --- 2.4 신규: 해외송금 (Remittance) ---
async function processRemittance(isEdit) {
    const record = {
        date: document.getElementById('remit-date').value,
        company: document.getElementById('remit-company').value.trim(),
        brand: document.getElementById('remit-brand').value.trim(),
        itemCategory: document.getElementById('remit-item-category').value,
        product: document.getElementById('remit-product').value.trim(),
        spec: document.getElementById('remit-spec').value.trim(),
        quantity: Number(document.getElementById('remit-quantity').value) || 0,
        unit: document.getElementById('remit-unit').value,
        unitPrice: Number(document.getElementById('remit-unit-price').value) || 0,
        totalAmount: Number(document.getElementById('remit-total-amount').value) || 0,
        notes: document.getElementById('remit-notes').value.trim()
    };

    if (!record.date || !record.company || !record.brand || record.quantity <= 0 || record.unitPrice < 0) {
        return alert('필수 항목(날짜, 업체, 브랜드, 수량, 단가)을 모두 입력해주세요.');
    }

    try {
        if (isEdit && editingRemittanceId) {
            await remittancesCollection.doc(editingRemittanceId).update(record);
            alert('해외 송금 내역이 성공적으로 수정되었습니다.');
        } else {
            await remittancesCollection.add(record);
            alert('해외 송금 내역이 성공적으로 등록되었습니다.');
        }
        cancelRemittanceEdit();
    } catch (error) {
        console.error("해외송금 데이터 저장/수정 오류:", error);
        alert(`해외송금 데이터를 처리하는 중 오류가 발생했습니다: ${error.message}`);
    }
}

async function deleteSelectedRemittances() {
    const selectedIds = Array.from(document.querySelectorAll('.remittance-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) return alert('삭제할 항목을 선택하세요.');
    if (!confirm(`선택된 ${selectedIds.length}개의 송금 내역을 삭제하시겠습니까?`)) return;
    try {
        if (editingRemittanceId && selectedIds.includes(editingRemittanceId)) {
            cancelRemittanceEdit();
        }
        const batch = db.batch();
        selectedIds.forEach(id => batch.delete(remittancesCollection.doc(id)));
        await batch.commit();
        alert(`${selectedIds.length}개의 송금 내역이 삭제되었습니다.`);
    } catch (error) {
        console.error("해외송금 데이터 삭제 오류:", error);
        alert("해외송금 데이터를 삭제하는 중 오류가 발생했습니다.");
    }
}


// ================== 3. 백업/복원 기능 추가 ==================

function backupDataToJson() {
    const backupData = { 
        transactions: transactions, 
        importCostSheets: ic_costSheets,
        sales: sales,
       remittances: remittances,
    purchases: purchases, // [추가]
    expenditureMemos: expenditureMemos // [수정] memos -> expenditureMemos 로 변경
};
    const jsonString = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `grutex_firebase_backup_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
}

function loadBackupFile(event) {
    const file = event.target.files[0];
    if (file) {
        currentBackupFile = file;
        document.getElementById('backup-status').innerText = `선택된 파일: ${file.name}`;
        document.getElementById('restore-button').disabled = false;
    } else {
        currentBackupFile = null;
        document.getElementById('backup-status').innerText = '';
        document.getElementById('restore-button').disabled = true;
    }
}

async function restoreDataFromJson() {
    if (!currentBackupFile) return alert('먼저 복원할 백업 파일을 선택해주세요.');
    if (prompt("경고: 이 작업은 클라우드의 모든 데이터를 덮어씁니다. 계속하려면 '복원합니다' 라고 정확히 입력해주세요.") !== '복원합니다') {
        return alert('복원 작업이 취소되었습니다.');
    }
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const parsedData = JSON.parse(e.target.result);
 
            // [수정] !parsedData.memos -> !parsedData.expenditureMemos 로 변경
if (!parsedData.transactions || !parsedData.importCostSheets || !parsedData.sales || !parsedData.remittances || !parsedData.purchases || !parsedData.expenditureMemos) { 
    return alert('선택된 파일이 유효한 백업 파일이 아닙니다. (필수 데이터 누락)');
}
            alert('복원을 시작합니다. 완료 메시지가 나타날 때까지 기다려주세요.');
            
            // [수정] purchases, memos 컬렉션 가져오기 추가
           // [수정] oldMemos -> oldExpMemos, memosCollection -> expenditureMemosCollection
const [oldTrans, oldSheets, oldSales, oldRemits, oldPurchases, oldExpMemos] = await Promise.all([ 
    transactionsCollection.get(), 
    importCostSheetsCollection.get(),
    salesCollection.get(),
    remittancesCollection.get(),
    purchasesCollection.get(),
    expenditureMemosCollection.get() // <-- 수정
]);
            const deleteBatch = db.batch();
            oldTrans.docs.forEach(doc => deleteBatch.delete(doc.ref));
            oldSheets.docs.forEach(doc => deleteBatch.delete(doc.ref));
            oldSales.docs.forEach(doc => deleteBatch.delete(doc.ref));
            oldRemits.docs.forEach(doc => deleteBatch.delete(doc.ref));
            oldPurchases.docs.forEach(doc => deleteBatch.delete(doc.ref)); 
            // [수정] oldMemos -> oldExpMemos
           oldExpMemos.docs.forEach(doc => deleteBatch.delete(doc.ref)); // <-- 수정
await deleteBatch.commit();

            const addBatch = db.batch();
            parsedData.transactions.forEach(doc => { const { id, ...data } = doc; addBatch.set(transactionsCollection.doc(), data); });
            parsedData.importCostSheets.forEach(doc => { const { id, ...data } = doc; addBatch.set(importCostSheetsCollection.doc(), data); });
            parsedData.sales.forEach(doc => { const { id, ...data } = doc; addBatch.set(salesCollection.doc(), data); });
            parsedData.remittances.forEach(doc => { const { id, ...data } = doc; addBatch.set(remittancesCollection.doc(), data); });
            parsedData.purchases.forEach(doc => { const { id, ...data } = doc; addBatch.set(purchasesCollection.doc(), data); });
// [수정] parsedData.memos -> parsedData.expenditureMemos, memosCollection -> expenditureMemosCollection
// expenditureMemos는 { 'YYYY-MM': ['note1', 'note2'], ... } 형태이므로 다르게 처리
Object.entries(parsedData.expenditureMemos).forEach(([monthKey, notesArray]) => {
    if (typeof monthKey === 'string' && monthKey.match(/^\d{4}-\d{2}$/) && Array.isArray(notesArray)) {
         addBatch.set(expenditureMemosCollection.doc(monthKey), { notes: notesArray }); // <-- 수정된 로직
    }
});
await addBatch.commit();
           
            document.getElementById('backup-status').innerText = '데이터가 성공적으로 복원되었습니다.';
            alert('데이터 복원이 완료되었습니다!');
        } catch (error) {
            console.error("복원 중 오류 발생:", error);
            alert('파일 처리 또는 데이터 복원 중 오류가 발생했습니다.');
        } finally {
            currentBackupFile = null; 
            document.getElementById('backup-file').value = ''; 
            document.getElementById('restore-button').disabled = true;
        }
    };
    reader.readAsText(currentBackupFile);
}

// ================== 4. UI 및 비즈니스 로직 ==================

function updateDatalists() {
    const sets = { brand: new Set(), lot: new Set(), company: new Set() };
    transactions.forEach(t => {
        if (t.brand) sets.brand.add(t.brand);
        if (t.lot) sets.lot.add(t.lot);
        if (t.company) sets.company.add(t.company);
    });
    sales.forEach(s => {
        if (s.brand) sets.brand.add(s.brand);
        if (s.company) sets.company.add(s.company);
    });
    remittances.forEach(r => {
        if (r.brand) sets.brand.add(r.brand);
        if (r.company) sets.company.add(r.company);
    });

 // [추가]
    purchases.forEach(p => {
        if (p.brand) sets.brand.add(p.brand);
        if (p.company) sets.company.add(p.company);
    });

    const toOption = item => `<option value="${item}"></option>`;
    document.getElementById('brand-list').innerHTML = [...sets.brand].sort().map(toOption).join('');
    document.getElementById('lot-list').innerHTML = [...sets.lot].sort().map(toOption).join('');
    document.getElementById('company-list-tran').innerHTML = [...sets.company].sort().map(toOption).join('');
    document.getElementById('company-list-invoice').innerHTML = [...sets.company].sort().map(toOption).join('');
}

// --- updateAll 함수 수정 ---
function updateAll() {
    recalculateInventory(); 
    applyFiltersAndRender(); 
    updateDatalists();
    // generateSalesReport(); // [삭제] 2) 매출 보고서 삭제
    displayInventorySummary();
    // updateDashboard(); // [삭제] 2) 대시보드 삭제
}

// --- showTab 함수 수정 ---
function showTab(tabName) {
    document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    // 탭 버튼 활성화
    const tabButton = document.querySelector(`.tab[onclick="showTab('${tabName}')"]`);
    if (tabButton) tabButton.classList.add('active');
    // 해당 탭 내용 활성화
    const tabContent = document.getElementById(tabName);
    if (tabContent) tabContent.classList.add('active');

    // 다른 탭으로 이동 시 편집 상태 초기화
    cancelTransactionEdit();
    cancelSaleEdit();
    cancelRemittanceEdit();
    // [추가 START]
    cancelPurchaseEdit();
   // [추가 END]
    ic_clearForm();

// [아래 추가]
// '중요 메모장' 탭(이제 현황판)을 누르면 3개 컬럼의 데이터를 새로고침
if (tabName === 'memo') {
    renderAllExpenditureViews();
}
    // [삭제] 2) 매출 보고서 및 대시보드 관련 로직 삭제
    // if (tabName === 'sales-report') generateSalesReport();
    // if (tabName === 'dashboard') updateDashboard();


    // 거래명세표/청구서 탭이 아닐 경우 관련 영역 숨기기
    if (tabName !== 'invoice') {
         const invoiceWrapper = document.getElementById('invoice-wrapper');
         const billWrapper = document.getElementById('bill-wrapper');
         if(invoiceWrapper) invoiceWrapper.style.display = 'none';
         if(billWrapper) billWrapper.style.display = 'none';
    }
    // 'invoice' 탭일 경우, generateInvoice/generateBill 함수가 display를 'block'으로 설정합니다.
}

// ... (ic_pFloat, toggleOtherCostsField, applyFiltersAndRender 등 기존 함수들 유지)


function applyFiltersAndRender() {
    const invFilters = {
        brand: document.getElementById('filter-inv-brand').value.toLowerCase(),
        product: document.getElementById('filter-inv-product').value.toLowerCase(),
        spec: document.getElementById('filter-inv-spec').value.toLowerCase(),
        lot: document.getElementById('filter-inv-lot').value.toLowerCase()
    };
    const filteredInventory = inventory.filter(i => 
        i.brand.toLowerCase().includes(invFilters.brand) &&
        (i.product || '').toLowerCase().includes(invFilters.product) &&
        (i.spec || '').toLowerCase().includes(invFilters.spec) &&
        i.lot.toLowerCase().includes(invFilters.lot)
    );
    updateInventoryTable(filteredInventory);
    displayInventorySummary(); // 파라미터 없이 호출 (이미 올바름)

    const tranFilters = {
        type: document.getElementById('filter-tran-type').value,
        month: document.getElementById('filter-tran-month').value,
        brand: document.getElementById('filter-tran-brand').value.toLowerCase(),
        product: document.getElementById('filter-tran-product').value.toLowerCase(),
        spec: document.getElementById('filter-tran-spec').value.toLowerCase(),
        lot: document.getElementById('filter-tran-lot').value.toLowerCase(),
        company: document.getElementById('filter-tran-company').value.toLowerCase()
    };
    const filteredTransactions = transactions.filter(t => 
        (!tranFilters.type || t.type === tranFilters.type) &&
        (!tranFilters.month || t.date.startsWith(tranFilters.month)) &&
        (t.brand?.toLowerCase().includes(tranFilters.brand)) &&
        (t.product?.toLowerCase().includes(tranFilters.product)) &&
        (t.spec?.toLowerCase().includes(tranFilters.spec)) &&
        (t.lot?.toLowerCase().includes(tranFilters.lot)) && 
        (t.company.toLowerCase().includes(tranFilters.company))
    );
    updateTransactionTable(filteredTransactions);
}

function resetInventoryFilters() {
    ['filter-inv-brand', 'filter-inv-product', 'filter-inv-spec', 'filter-inv-lot'].forEach(id => document.getElementById(id).value = '');
    applyFiltersAndRender();
}

function resetTransactionFilters() {
    ['filter-tran-type', 'filter-tran-month', 'filter-tran-brand', 'filter-tran-product', 'filter-tran-spec', 'filter-tran-lot', 'filter-tran-company'].forEach(id => document.getElementById(id).value = '');
    applyFiltersAndRender();
}

function resetSalesReportFilters() {
  ['filter-report-start-date', 'filter-report-end-date', 'filter-report-company', 'filter-report-brand', 'filter-report-item-category', 'filter-report-product', 'filter-report-spec']
  .forEach(id => document.getElementById(id).value = '');
    generateSalesReport();
}

function recalculateInventory() {
    const tempInventoryMap = new Map();
    const sortedTransactions = [...transactions].sort((a, b) => new Date(a.date) - new Date(b.date));

    sortedTransactions.forEach(t => {
        const itemKey = `${t.brand}_${t.product}_${t.spec}_${t.lot}`;
        if (!tempInventoryMap.has(itemKey)) {
            tempInventoryMap.set(itemKey, {
                id: itemKey, brand: t.brand, lot: t.lot, quantity: 0, product: t.product,
                spec: t.spec, costPrice: 0, receivedDate: null
            });
        }
        const currentItem = tempInventoryMap.get(itemKey);
        const weight = parseFloat(t.weight) || 0;
        
        if (t.type === '입고') {
            currentItem.quantity += weight;
            // [수정] 1) 재고의 원가(costPrice)를 입고의 '원가(costPrice)'로 업데이트 (기존 unitPrice -> costPrice)
            if (t.costPrice > 0) currentItem.costPrice = t.costPrice;
            if (t.product) currentItem.product = t.product;
            if (t.spec) currentItem.spec = t.spec;
            if (!currentItem.receivedDate || new Date(t.date) < new Date(currentItem.receivedDate)) {
                currentItem.receivedDate = t.date;
            }
        } else if (t.type === '출고') {
            currentItem.quantity -= weight;
        }
    });
    
    inventory = Array.from(tempInventoryMap.values()).map(item => {
        if (item.quantity < 0.0001) item.quantity = 0;
        return item;
    });
}

function updateInventoryTable(itemsToDisplay) {
    const tbody = document.getElementById('inventory-tbody');
    tbody.innerHTML = '';
    const totalWeight = itemsToDisplay.reduce((sum, item) => sum + item.quantity, 0);
    
    itemsToDisplay.sort((a,b)=> (a.brand+a.lot).localeCompare(b.brand+b.lot)).forEach(item => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${item.brand}</td> <td>${item.product || 'N/A'}</td> <td>${item.spec || ''}</td>
            <td>${item.lot}</td> <td>${item.quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${formatShortDate(item.receivedDate) || '-'}</td>
            <td><button class="action-btn" onclick="showItemHistoryInTransactionTab('${item.brand}', '${item.product || ''}', '${item.spec || ''}', '${item.lot}')">내역</button></td>`;
   
     }); 


   document.getElementById('total-inv-weight').innerText = totalWeight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// START: 품목별 재고 요약 함수 추가
function displayInventorySummary() {
    const summary = {};
    // 전체 인벤토리 데이터(필터링 안된 것)를 기준으로 요약 계산
    inventory.forEach(item => {
        if (item.quantity < 0.0001) return; // 0 또는 아주 작은 재고는 제외
        // 키 생성: 브랜드 / 제품 / 스펙
        const key = `${item.brand || 'N/A'} / ${item.product || 'N/A'} / ${item.spec || 'N/A'}`;
        summary[key] = (summary[key] || 0) + item.quantity;
    });

    const tbody = document.getElementById('inventory-summary-tbody');
    tbody.innerHTML = '';
    let totalSummaryWeight = 0;

    // 키(브랜드/제품/스펙) 기준으로 정렬하여 표시
    Object.keys(summary).sort().forEach(key => {
        const quantity = summary[key];
        totalSummaryWeight += quantity;
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${key}</td>
            <td style="text-align: right; padding-right: 10px;">${quantity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg</td>
        `;
    });

    // 총 합계 업데이트
    document.getElementById('total-summary-inv-weight').innerText = totalSummaryWeight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kg';
}
// END: 품목별 재고 요약 함수 추가


function showItemHistoryInTransactionTab(brand, product, spec, lot) {
    showTab('transaction');
    document.getElementById('filter-tran-brand').value = brand;
    document.getElementById('filter-tran-product').value = product;
    document.getElementById('filter-tran-spec').value = spec;
    document.getElementById('filter-tran-lot').value = lot;
    applyFiltersAndRender();
}

// [수정] 1) 입출고 내역 테이블 업데이트 (판가/원가/총매출/총마진)
function updateTransactionTable(transactionsToDisplay) {
    const tbody = document.getElementById('transaction-tbody');
    tbody.innerHTML = '';
    let totalWeight = 0, totalSales = 0, totalMargin = 0; // [수정] 합계 변수 변경

    transactionsToDisplay.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(t => {
        const weight = parseFloat(t.weight) || 0;
        // [수정] amount -> totalSales, totalMargin
        const sales = parseFloat(t.totalSales) || 0;
        const margin = parseFloat(t.totalMargin) || 0;
        
        if(t.type === '입고') {
            totalWeight += weight;
            // 입고는 매출/마진 합계에 포함하지 않음 (출고 기준 합계)
        } else { // 출고
            totalWeight -= weight;
            totalSales += sales;
            totalMargin += margin;
        }
       
        const row = tbody.insertRow();
        row.innerHTML = `
            <td><input type="checkbox" class="transaction-checkbox" value="${t.id}"></td>
            <td>${t.type}</td><td>${t.date}</td><td>${t.brand || ''}</td>
            <td>${t.product || ''}</td><td>${t.spec || ''}</td><td>${t.lot || ''}</td>
            <td>${weight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            
            <td>${(t.sellingPrice || 0).toLocaleString('en-US')}</td>
            <td>${(t.costPrice || 0).toLocaleString('en-US')}</td>
            <td>${sales.toLocaleString('en-US')}</td>
            <td>${margin.toLocaleString('en-US')}</td>

            <td>${t.company}</td><td>${t.notes || ''}</td><td>${t.destination || ''}</td><td>${t.specialNotes || ''}</td>`;
    });

    // [수정] 합계 표시 (total-tran-amount -> total-tran-sales, total-tran-margin)
    document.getElementById('total-tran-weight').innerText = totalWeight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById('total-tran-sales').innerText = totalSales.toLocaleString('en-US');
    document.getElementById('total-tran-margin').innerText = totalMargin.toLocaleString('en-US');
    
    document.getElementById('select-all-transactions').checked = false;
}

// [수정] 1) 입출고 수정 폼 (판가/원가/총매출/총마진)
function editSelectedTransaction() {
    const selectedIds = Array.from(document.querySelectorAll('.transaction-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length !== 1) return alert('수정할 항목을 하나만 선택하세요.');
    
    const transaction = transactions.find(t => t.id === selectedIds[0]);
    if (!transaction) return alert("오류: 데이터를 찾을 수 없습니다. 페이지를 새로고침하고 다시 시도해주세요.");
    
    editingTransactionId = transaction.id;
    document.getElementById('transaction-type').value = transaction.type;
    document.getElementById('transaction-date').value = transaction.date;
    document.getElementById('tran-brand').value = transaction.brand;
    document.getElementById('tran-lot').value = transaction.lot;
    document.getElementById('tran-product').value = transaction.product || '';
    document.getElementById('tran-spec').value = transaction.spec || '';
    document.getElementById('transaction-weight').value = transaction.weight;
    
    // [수정] 판가, 원가, 총매출, 총마진
    document.getElementById('transaction-selling-price').value = transaction.sellingPrice || '';
    document.getElementById('transaction-cost-price').value = transaction.costPrice || '';
    document.getElementById('transaction-total-sales').value = transaction.totalSales || '';
    document.getElementById('transaction-total-margin').value = transaction.totalMargin || '';
    
    // [삭제] 1) 단가, 기타비용 삭제
    // document.getElementById('transaction-unit-price').value = transaction.unitPrice || '';
    // document.getElementById('transaction-other-costs').value = transaction.otherCosts || '';

    document.getElementById('transaction-company').value = transaction.company;
    document.getElementById('transaction-notes').value = transaction.notes || '';
    document.getElementById('transaction-destination').value = transaction.destination || '';
    document.getElementById('transaction-special-notes').value = transaction.specialNotes || '';
    
    // toggleOtherCostsField(); // [삭제] 1)
    document.getElementById('transaction-form-title').innerText = '입출고 수정';
    document.getElementById('transaction-form-buttons').innerHTML = `
        <button class="btn btn-success" onclick="processTransaction(true)">수정 저장</button>
        <button class="btn btn-secondary" onclick="cancelTransactionEdit()">취소</button>`;
    window.scrollTo(0, 0);
}

// [수정] 1) 입출고 수정 취소 (폼 초기화)
function cancelTransactionEdit() {
    editingTransactionId = null;
    // [수정] 폼의 input-group을 찾아 리셋
    const form = document.querySelector('#transaction .section .input-group');
    if (form) {
        Array.from(form.querySelectorAll('input, select')).forEach(input => {
            if (input.type === 'select-one') input.selectedIndex = 0;
            else if (input.id !== 'transaction-date') input.value = '';
        });
    }
    document.getElementById('transaction-date').value = new Date().toISOString().slice(0, 10);
    
    // [수정] 1) 자동 계산 필드도 ''(빈칸)으로 초기화
    document.getElementById('transaction-total-sales').value = '';
    document.getElementById('transaction-total-margin').value = '';

    document.getElementById('transaction-form-title').innerText = '입출고 등록';
    document.getElementById('transaction-form-buttons').innerHTML = `
        <button class="btn btn-primary" onclick="addTransaction()">입출고 등록</button>
        <button class="btn btn-warning" onclick="openBulkUploadModal()">대량 입출고 등록</button>`;
    // toggleOtherCostsField(); // [삭제] 1)
}

function autoFillItemDetails() {
    if (editingTransactionId) return;
    const brand = document.getElementById('tran-brand').value.trim();
    const lot = document.getElementById('tran-lot').value.trim();
    if (!brand || !lot) return; 

    const recent = transactions.filter(t => t.brand === brand && t.lot === lot).sort((a,b) => new Date(b.date) - new Date(a.date))[0];
    if (recent) {
        document.getElementById('tran-product').value = recent.product || '';
        document.getElementById('tran-spec').value = recent.spec || '';
        // [수정] 1) 자동완성 시 판가/원가를 가져오도록 수정
        if (recent.sellingPrice > 0) document.getElementById('transaction-selling-price').value = recent.sellingPrice;
        if (recent.costPrice > 0) document.getElementById('transaction-cost-price').value = recent.costPrice;
    }
}

function openBulkUploadModal() { document.getElementById('bulkUploadModal').style.display = 'flex'; }
function closeBulkUploadModal() { document.getElementById('bulkUploadModal').style.display = 'none'; }

function downloadBulkTransactionTemplate() {
    // [수정] 1) CSV 템플릿 헤더 변경 (판가/원가 추가, 기타비용 삭제)
    const headers = ['거래구분(입고/출고)', '날짜(YYYY-MM-DD)*', '브랜드*', 'LOT 번호*', '중량(kg)*', '판가(원/kg)*', '원가(원/kg)', '제품', '스펙 (예: 75/48)', '업체*', '비고', '도착지', '특이사항'];
    downloadCSV(headers.join(','), '대량입출고_템플릿');
}

// [수정] 1) '입출고 현황' CSV 처리 함수 수정 (판가/원가 적용, 기타비용 삭제)
function processBulkUpload() {
    const file = document.getElementById('bulk-csv-file').files[0];
    if (!file) return alert('파일을 선택해주세요.');
    
    Papa.parse(file, {
        header: true, skipEmptyLines: true,
        complete: (results) => {
            const records = results.data.map(row => {
                const weight = ic_pFloat(row['중량(kg)*']);
                // [수정] '단가' -> '판가'
                const sellingPrice = ic_pFloat(row['판가(원/kg)*']); 
                // [수정] '원가' 추가
                const costPrice = ic_pFloat(row['원가(원/kg)']);
                const totalSales = weight * sellingPrice;
                const totalMargin = totalSales - (weight * costPrice);

                return {
                    type: row['거래구분(입고/출고)']?.trim() || '입고', 
                    date: row['날짜(YYYY-MM-DD)*']?.trim() || '',
                    brand: row['브랜드*']?.trim() || '', 
                    lot: row['LOT 번호*']?.trim() || '',
                    weight: weight,
                    sellingPrice: sellingPrice, // [수정]
                    costPrice: costPrice,     // [수정]
                    totalSales: totalSales,     // [수정]
                    totalMargin: totalMargin,   // [수정]
                    // otherCosts: ic_pFloat(row['기타 비용']), // [삭제] 1) 기타 비용 삭제
                    product: row['제품']?.trim() || '',
                    spec: row['스펙 (예: 75/48)']?.trim() || '', 
                    company: row['업체*']?.trim() || '', 
                    notes: row['비고']?.trim() || '', 
                    destination: row['도착지']?.trim() || '', 
                    specialNotes: row['특이사항']?.trim() || ''
                };
            });

            // [수정] 1) 유효성 검사 (processTransaction과 동일하게)
            const validRecords = records.filter(r => r.date && r.brand && r.lot && r.weight > 0 && r.company);
            const invalidCount = records.length - validRecords.length;
            
            if (invalidCount > 0) {
                alert(`총 ${records.length}건 중 ${invalidCount}건의 데이터에 필수 항목(날짜, 브랜드, LOT, 중량, 업체)이 누락되어 제외됩니다.`);
            }

            if (validRecords.length > 0) {
                processBulkTransactions(validRecords); // 유효한 레코드만 전달
            } else {
                alert('처리할 유효한 데이터가 없습니다.');
            }
            closeBulkUploadModal(); // [수정] 1) 탭 꼬임 방지를 위해 완료 후 모달 닫기
        },
        error: (error) => {
            console.error('CSV 파싱 오류:', error);
            alert(`CSV 파일 파싱 오류: ${error.message}`);
            closeBulkUploadModal(); // [수정] 1) 오류 시에도 모달 닫기
        }
    });
}

function downloadCSV(csvContent, filename) {
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
}

function exportInventoryCSV() {
    const csvData = inventory.map(item => ({
        '브랜드': item.brand, '제품': item.product || '','스펙': item.spec || '','LOT': item.lot,
        '현재 수량(kg)': item.quantity.toFixed(2)
    }));
    downloadCSV(Papa.unparse(csvData), '재고현황');
}

// [수정] 1) 입출고 현황 CSV 내보내기 (판가/원가/총매출/총마진)
function exportTransactionCSV() {
    const csvData = transactions.sort((a,b) => new Date(b.date) - new Date(a.date)).map(t => ({
        '거래구분': t.type, '날짜': t.date, '브랜드': t.brand, '제품': t.product, '스펙': t.spec, 'LOT': t.lot,
        '중량(kg)': t.weight, 
        // [수정]
        '판가(원/kg)': t.sellingPrice, 
        '원가(원/kg)': t.costPrice, 
        '총매출(원)': t.totalSales, 
        '총마진(원)': t.totalMargin,
        '업체': t.company, '비고': t.notes, '도착지': t.destination, '특이사항': t.specialNotes
    }));
    downloadCSV(Papa.unparse(csvData), '입출고현황');
}

// START: CSV 처리 공통 함수 추가
// 파일 선택 시 호출되는 공통 핸들러
function handleCsvUpload(event, previewDivId, contentDivId, setDataCallback) {
    const file = event.target.files[0];
    const previewDiv = document.getElementById(previewDivId);
    if (file && previewDiv) {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            preview: 5, // 미리보기는 첫 5줄만
            complete: (results) => {
                if (results.data && results.data.length > 0) {
                    setDataCallback(results.data); // 미리보기용 데이터 저장 (전체 아님)
                    displayCsvPreview(results.data, results.meta.fields, contentDivId);
                    previewDiv.style.display = 'block';
                } else {
                    setDataCallback(null);
                    previewDiv.style.display = 'none';
                    alert('CSV 파일에 유효한 데이터가 없거나 헤더만 있습니다.');
                }
            },
            error: (error) => {
                console.error('CSV 파싱 오류:', error);
                alert(`CSV 파일을 읽는 중 오류가 발생했습니다: ${error.message}`);
                previewDiv.style.display = 'none';
                setDataCallback(null);
            }
        });
    } else if (previewDiv) {
        previewDiv.style.display = 'none';
        setDataCallback(null);
    }
}

// 미리보기 테이블 생성 함수
function displayCsvPreview(data, headers, contentElementId) {
    const previewContent = document.getElementById(contentElementId);
    if (!previewContent) return;
    let tableHTML = '<table style="width:100%; font-size: 12px; border-collapse: collapse;"><thead><tr>';
    tableHTML += headers.map(h => `<th style="border: 1px solid #ddd; padding: 5px; background-color: #f2f2f2;">${h}</th>`).join('');
    tableHTML += '</tr></thead><tbody>';
    data.forEach(row => {
        tableHTML += `<tr>${headers.map(h => `<td style="border: 1px solid #ddd; padding: 5px;">${row[h] || ''}</td>`).join('')}</tr>`;
    });
    tableHTML += '</tbody></table>';
    if (data.length === 5) { // 미리보기가 5줄 꽉 찼으면 안내 문구 추가
        tableHTML += '<p style="font-size: 11px; color: #888; margin-top: 5px;">(첫 5줄 미리보기)</p>';
    }
    previewContent.innerHTML = tableHTML;
}

// CSV 업로드 처리 공통 로직
async function processCsvData(previewData, fileInputId, processRowCallback, cancelCallback, dataTypeLabel) {
    const fileInput = document.getElementById(fileInputId);
    const file = fileInput.files[0];

    if (!file) {
        return alert(`${dataTypeLabel} CSV 파일을 먼저 선택해주세요.`);
    }
    if (!previewData) { // previewData는 handleCsvUpload에서 설정됨
         return alert(`미리보기 데이터가 없습니다. 파일을 다시 선택해주세요.`);
    }

    alert(`${dataTypeLabel} 데이터 업로드를 시작합니다. 완료 메시지가 나올 때까지 기다려주세요.`);

    Papa.parse(file, { // 실제 처리는 전체 파일로 다시 파싱
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
            const rows = results.data;
            if (!rows || rows.length === 0) {
                cancelCallback();
                return alert('CSV 파일에 처리할 데이터가 없습니다.');
            }

            let successCount = 0;
            let failCount = 0;
            const promises = [];

            rows.forEach((row, index) => {
                            try {
                                const promise = processRowCallback(row, index);
                                if (promise) { // 유효성 검사 통과 및 Firestore 작업 Promise 반환 시
                                    promises.push(promise.then(() => successCount++).catch(err => {
                                        console.error(`행 ${index + 2} 처리 오류:`, err);
                                        failCount++;
                                    }));
                                } else { // 유효성 검사 실패 시 (processRowCallback이 null 반환)
                                    failCount++;
                                }
                            } catch (e) { // processRowCallback 자체에서 동기적 에러 발생 시
                                console.error(`행 ${index + 2} 파싱/유효성 검사 중 동기 오류:`, e);
                                failCount++;
                            }
                        });

            try {
                await Promise.all(promises); // 모든 Firestore 작업 기다리기
                alert(`${dataTypeLabel} CSV 처리 완료: 성공 ${successCount}건, 실패 ${failCount}건.`);
            } catch (batchError) {
                // Firestore 배치 작업 중 하나라도 실패하면 여기로 올 수 있음 (개별 처리 시는 위에서 잡힘)
                console.error(`${dataTypeLabel} 일괄 처리 중 오류:`, batchError);
                alert(`${dataTypeLabel} 처리 중 일부 오류 발생. 성공 ${successCount}건, 실패 ${failCount}건 이상.`);
            } finally {
                cancelCallback(); // 미리보기 닫기 및 관련 상태 초기화
                // 데이터가 변경되었으므로 관련 테이블 업데이트 (예: displaySales(), displayRemittances())
                // 이 부분은 각 탭의 process 함수 내에서 호출되거나 여기서 직접 호출할 수 있음
                // 예시: if (dataTypeLabel === '매출') applySalesFiltersAndRender();
                //       if (dataTypeLabel === '해외송금') applyRemittanceFiltersAndRender();
                // updateAll()을 호출하면 모든 데이터가 리프레시되지만, Firestore 리스너가 있다면 자동으로 반영될 수 있음
            }
        },
        error: (error) => {
            console.error('CSV 전체 파싱 오류:', error);
            alert(`CSV 파일 처리 중 오류가 발생했습니다: ${error.message}`);
            cancelCallback();
        }
    });
}

// CSV 미리보기 및 파일 선택 취소 공통 함수
function cancelCsvUpload(fileInputId, previewDivId, resetDataCallback) {
    const fileInput = document.getElementById(fileInputId);
    const previewDiv = document.getElementById(previewDivId);
    if (fileInput) fileInput.value = ''; // 파일 선택 초기화
    if (previewDiv) previewDiv.style.display = 'none'; // 미리보기 숨기기
    resetDataCallback(); // 해당 CSV 데이터 변수 초기화 (예: salesCsvData = null)
}
// END: CSV 처리 공통 함수 추가


// [추가] 1) 입출고 탭 총매출/총마진 자동 계산
function calculateTransactionTotals() {
    const weight = Number(document.getElementById('transaction-weight').value) || 0;
    const sellingPrice = Number(document.getElementById('transaction-selling-price').value) || 0;
    const costPrice = Number(document.getElementById('transaction-cost-price').value) || 0;
    const totalSales = weight * sellingPrice;
    const totalCost = weight * costPrice;
    const totalMargin = totalSales - totalCost;
    document.getElementById('transaction-total-sales').value = totalSales;
    document.getElementById('transaction-total-margin').value = totalMargin;
}

// ================== 4-1. 신규 매출 탭 관련 함수 ==================

function calculateSales() {
    const quantity = Number(document.getElementById('sales-quantity').value) || 0;
    const sellingPrice = Number(document.getElementById('sales-selling-price').value) || 0;
    const costPrice = Number(document.getElementById('sales-cost-price').value) || 0;
    const totalSales = quantity * sellingPrice;
    const totalCost = quantity * costPrice;
    const totalMargin = totalSales - totalCost;
    document.getElementById('sales-total-sales').value = totalSales;
    document.getElementById('sales-total-margin').value = totalMargin;
}

function applySalesFiltersAndRender() {
    const filters = {
        startMonth: document.getElementById('filter-sales-start-month').value,
        endMonth: document.getElementById('filter-sales-end-month').value,
        company: document.getElementById('filter-sales-list-company').value.toLowerCase(),
        brand: document.getElementById('filter-sales-list-brand').value.toLowerCase(),
        itemCategory: document.getElementById('filter-sales-list-item-category').value.toLowerCase(),
        product: document.getElementById('filter-sales-list-product').value.toLowerCase(),
        spec: document.getElementById('filter-sales-list-spec').value.toLowerCase(),
    };
    const filteredSales = sales.filter(s => {
        const month = s.date.substring(0, 7);
        const startCheck = !filters.startMonth || month >= filters.startMonth;
        const endCheck = !filters.endMonth || month <= filters.endMonth;
        return startCheck && endCheck &&
               (s.company || '').toLowerCase().includes(filters.company) &&
               (s.brand || '').toLowerCase().includes(filters.brand) &&
               (s.itemCategory || '').toLowerCase().includes(filters.itemCategory) &&
               (s.product || '').toLowerCase().includes(filters.product) &&
               (s.spec || '').toLowerCase().includes(filters.spec);
    });
    updateSalesTable(filteredSales);
}

function updateSalesTable(salesToDisplay) {
    const tbody = document.getElementById('sales-tbody');
    tbody.innerHTML = '';
    let totalSalesSum = 0;
    let totalMarginSum = 0;

    salesToDisplay.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(s => {
        totalSalesSum += s.totalSales || 0;
        totalMarginSum += s.totalMargin || 0;

        const row = tbody.insertRow();
        row.innerHTML = `
            <td><input type="checkbox" class="sales-checkbox" value="${s.id}"></td>
            <td>${s.date}</td><td>${s.company}</td><td>${s.brand}</td>
            <td>${s.itemCategory}</td><td>${s.product || ''}</td><td>${s.spec || ''}</td>
            <td>${s.quantity.toLocaleString()} ${s.unit}</td>
            <td>${s.sellingPrice.toLocaleString()}</td><td>${s.costPrice.toLocaleString()}</td>
            <td>${s.totalSales.toLocaleString()}</td><td>${s.totalMargin.toLocaleString()}</td>
            <td>${s.notes || ''}</td>`;
    });
    
    // 총 합계 업데이트
    document.getElementById('total-sales-list-sales').innerText = totalSalesSum.toLocaleString();
    document.getElementById('total-sales-list-margin').innerText = totalMarginSum.toLocaleString();

    document.getElementById('select-all-sales').checked = false;
}

function editSelectedSale() {
    const selectedIds = Array.from(document.querySelectorAll('.sales-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length !== 1) return alert('수정할 항목을 하나만 선택하세요.');
    
    const sale = sales.find(s => s.id === selectedIds[0]);
    if (!sale) return alert("오류: 데이터를 찾을 수 없습니다.");
    
    editingSaleId = sale.id;
    document.getElementById('sales-date').value = sale.date;
    document.getElementById('sales-company').value = sale.company;
    document.getElementById('sales-brand').value = sale.brand;
    document.getElementById('sales-item-category').value = sale.itemCategory;
    document.getElementById('sales-product').value = sale.product || '';
    document.getElementById('sales-spec').value = sale.spec || '';
    document.getElementById('sales-quantity').value = sale.quantity;
    document.getElementById('sales-unit').value = sale.unit;
    document.getElementById('sales-selling-price').value = sale.sellingPrice;
    document.getElementById('sales-cost-price').value = sale.costPrice;
    document.getElementById('sales-total-sales').value = sale.totalSales;
    document.getElementById('sales-total-margin').value = sale.totalMargin;
    document.getElementById('sales-notes').value = sale.notes || '';
    
    document.getElementById('sales-form-title').innerText = '매출 수정';
    document.getElementById('sales-form-buttons').innerHTML = `
        <button class="btn btn-success" onclick="processSale(true)">수정 저장</button>
        <button class="btn btn-secondary" onclick="cancelSaleEdit()">취소</button>`;
    window.scrollTo(0, 0);
}

function cancelSaleEdit() {
    editingSaleId = null;
    document.getElementById('sales-form').reset();
    calculateSales();
    document.getElementById('sales-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('sales-form-title').innerText = '매출 등록';
    document.getElementById('sales-form-buttons').innerHTML = `
        <button class="btn btn-primary" onclick="addSale()">➕ 매출 등록</button>
        <button class="btn btn-success" onclick="downloadSalesCsvTemplate()">📥 CSV 템플릿 다운로드</button>
        <button class="btn btn-warning" onclick="document.getElementById('sales-csv-file').click()">📤 CSV 대량 등록</button>`;
}

function resetSalesFilters() {
    ['filter-sales-start-month', 'filter-sales-end-month', 'filter-sales-list-company', 'filter-sales-list-brand', 'filter-sales-list-item-category', 'filter-sales-list-product', 'filter-sales-list-spec']
    .forEach(id => document.getElementById(id).value = '');
    applySalesFiltersAndRender();
}

function exportSalesCSV() {
    const csvData = sales.sort((a,b) => new Date(b.date) - new Date(a.date)).map(s => ({
        '날짜': s.date, '업체': s.company, '브랜드': s.brand, '품목': s.itemCategory, '제품': s.product,
        '스펙': s.spec, '수량': s.quantity, '단위': s.unit, '판가(원)': s.sellingPrice, '원가(원)': s.costPrice,
        '총매출(원)': s.totalSales, '총마진(원)': s.totalMargin, '비고': s.notes
    }));
    downloadCSV(Papa.unparse(csvData), '매출내역');
}

// START: 매출 CSV 관련 함수 추가
function downloadSalesCsvTemplate() {
    const headers = ["날짜*", "업체*", "브랜드*", "품목*", "제품", "스펙", "수량*", "단위*", "판가(원)*", "원가(원)", "비고"];
    const csv = headers.join(',') + '\n';
    downloadCSV(csv, '매출_등록_템플릿');
}

function handleSalesCsvUpload(event) {
    handleCsvUpload(event, 'sales-csv-preview', 'sales-csv-content', (data) => { salesCsvData = data; });
}

// [수정] '일반 매출' CSV 처리 함수 수정 (ic_pFloat 적용)
function processSalesCsvUpload() {
    processCsvData(salesCsvData, 'sales-csv-file', (row, index) => {
        const sale = {
            date: row['날짜*']?.trim() || '',
            company: row['업체*']?.trim() || '',
            brand: row['브랜드*']?.trim() || '',
            itemCategory: row['품목*']?.trim() || '',
            product: row['제품']?.trim() || '',
            spec: row['스펙']?.trim() || '',
            quantity: ic_pFloat(row['수량*']), // [수정] Number -> ic_pFloat
            unit: row['단위*']?.trim() || 'kg',
            sellingPrice: ic_pFloat(row['판가(원)*']), // [수정] Number -> ic_pFloat
            costPrice: ic_pFloat(row['원가(원)']), // [수정] Number -> ic_pFloat
            notes: row['비고']?.trim() || ''
        };
        sale.totalSales = sale.quantity * sale.sellingPrice;
        sale.totalMargin = sale.totalSales - (sale.quantity * sale.costPrice);

if (!sale.date || !sale.company || !sale.brand || !sale.itemCategory || sale.quantity <= 0) {
            console.error(`매출 CSV 유효성 검사 실패 (행 ${index + 2}):`, row);
            return null; // 유효하지 않으면 null 반환
        }

        return salesCollection.add(sale); // Firestore에 추가하는 Promise 반환
    }, cancelSalesCsvUpload, '매출');
}

function cancelSalesCsvUpload() {
    cancelCsvUpload('sales-csv-file', 'sales-csv-preview', () => { salesCsvData = null; });
}
// END: 매출 CSV 관련 함수 추가

// ================== 4-2. 신규 해외송금 탭 관련 함수 ==================

function calculateRemittance() {
    const quantity = Number(document.getElementById('remit-quantity').value) || 0;
    const unitPrice = Number(document.getElementById('remit-unit-price').value) || 0;
    const total = quantity * unitPrice;
    document.getElementById('remit-total-amount').value = total.toFixed(2); // 소수점 2자리로 고정
}

function applyRemittanceFiltersAndRender() {
    const filters = {
        startMonth: document.getElementById('filter-remit-start-month').value,
        endMonth: document.getElementById('filter-remit-end-month').value,
        company: document.getElementById('filter-remit-company').value.toLowerCase(),
        brand: document.getElementById('filter-remit-brand').value.toLowerCase(),
        itemCategory: document.getElementById('filter-remit-item-category').value.toLowerCase(),
        product: document.getElementById('filter-remit-product').value.toLowerCase(),
        spec: document.getElementById('filter-remit-spec').value.toLowerCase()
    };
    const filteredRemittances = remittances.filter(r => {
        const month = r.date.substring(0, 7);
        const startCheck = !filters.startMonth || month >= filters.startMonth;
        const endCheck = !filters.endMonth || month <= filters.endMonth;
        return startCheck && endCheck &&
               (r.company || '').toLowerCase().includes(filters.company) &&
               (r.brand || '').toLowerCase().includes(filters.brand) &&
               (r.itemCategory || '').toLowerCase().includes(filters.itemCategory) &&
               (r.product || '').toLowerCase().includes(filters.product) &&
               (r.spec || '').toLowerCase().includes(filters.spec);
    });
    updateRemittanceTable(filteredRemittances);
}

function updateRemittanceTable(remittancesToDisplay) {
    const tbody = document.getElementById('remittance-tbody');
    tbody.innerHTML = '';
    let totalAmountSum = 0; // 총합계 변수 추가
    remittancesToDisplay.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(r => {
        totalAmountSum += r.totalAmount || 0; // 합계 계산
        const row = tbody.insertRow();
        row.innerHTML = `
            <td><input type="checkbox" class="remittance-checkbox" value="${r.id}"></td>
            <td>${r.date}</td><td>${r.company}</td><td>${r.brand}</td>
            <td>${r.itemCategory}</td><td>${r.product || ''}</td><td>${r.spec || ''}</td>
            <td>${r.quantity.toLocaleString()}</td><td>${r.unit}</td>
            <td>${(r.unitPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${(r.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td>${r.notes || ''}</td>`;
    });
    // 총합계 tfoot에 표시 (html에 tfoot이 추가되어 있어야 함)
    const totalEl = document.getElementById('total-remit-amount');
    if (totalEl) {
        totalEl.innerText = totalAmountSum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    document.getElementById('select-all-remittances').checked = false;
}


function editSelectedRemittance() {
    const selectedIds = Array.from(document.querySelectorAll('.remittance-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length !== 1) return alert('수정할 항목을 하나만 선택하세요.');
    
    const remittance = remittances.find(r => r.id === selectedIds[0]);
    if (!remittance) return alert("오류: 데이터를 찾을 수 없습니다.");
    
    editingRemittanceId = remittance.id;
    document.getElementById('remit-date').value = remittance.date;
    document.getElementById('remit-company').value = remittance.company;
    document.getElementById('remit-brand').value = remittance.brand;
    document.getElementById('remit-item-category').value = remittance.itemCategory;
    document.getElementById('remit-product').value = remittance.product || '';
    document.getElementById('remit-spec').value = remittance.spec || '';
    document.getElementById('remit-quantity').value = remittance.quantity;
    document.getElementById('remit-unit').value = remittance.unit;
   document.getElementById('remit-unit-price').value = (remittance.unitPrice || 0).toFixed(2);
    document.getElementById('remit-total-amount').value = (remittance.totalAmount || 0).toFixed(2);
    document.getElementById('remit-notes').value = remittance.notes || '';
    
    document.getElementById('remittance-form-title').innerText = '해외 송금 수정';
    document.getElementById('remittance-form-buttons').innerHTML = `
        <button class="btn btn-success" onclick="processRemittance(true)">수정 저장</button>
        <button class="btn btn-secondary" onclick="cancelRemittanceEdit()">취소</button>`;
    window.scrollTo(0, 0);
}

function cancelRemittanceEdit() {
    editingRemittanceId = null;
    document.getElementById('remittance-form').reset();
    calculateRemittance();
    document.getElementById('remit-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('remittance-form-title').innerText = '해외 송금 등록';
    document.getElementById('remittance-form-buttons').innerHTML = `
        <button class="btn btn-primary" onclick="addRemittance()">➕ 송금 등록</button>
        <button class="btn btn-success" onclick="downloadRemittanceCsvTemplate()">📥 CSV 템플릿 다운로드</button>
        <button class="btn btn-warning" onclick="document.getElementById('remit-csv-file').click()">📤 CSV 대량 등록</button>`;
}

function resetRemittanceFilters() {
    ['filter-remit-start-month', 'filter-remit-end-month', 'filter-remit-company', 'filter-remit-brand', 'filter-remit-item-category', 'filter-remit-product', 'filter-remit-spec']
    .forEach(id => document.getElementById(id).value = '');
    applyRemittanceFiltersAndRender();
}

function exportRemittanceCSV() {
    const csvData = remittances.sort((a,b) => new Date(b.date) - new Date(a.date)).map(r => ({
        '날짜': r.date, '업체': r.company, '브랜드': r.brand, '품목': r.itemCategory, '제품': r.product,
        '스펙': r.spec, '수량': r.quantity, '단위': r.unit, '단가($)': r.unitPrice,
        '총합계($)': r.totalAmount, '비고': r.notes
    }));
    downloadCSV(Papa.unparse(csvData), '해외송금내역');
}

// START: 해외송금 CSV 관련 함수 추가
function downloadRemittanceCsvTemplate() {
    const headers = ["날짜*", "업체*", "브랜드*", "품목*", "제품", "스펙", "수량*", "단위*", "단가($)*", "비고"];
    const csv = headers.join(',') + '\n';
    downloadCSV(csv, '해외송금_등록_템플릿');
}

function handleRemittanceCsvUpload(event) {
    handleCsvUpload(event, 'remit-csv-preview', 'remit-csv-content', (data) => { remitCsvData = data; });
}

// [수정] '해외 송금' CSV 처리 함수 수정 (ic_pFloat 적용)
function processRemittanceCsvUpload() {
    processCsvData(remitCsvData, 'remit-csv-file', (row, index) => {
        const remit = {
            date: row['날짜*']?.trim() || '',
            company: row['업체*']?.trim() || '',
            brand: row['브랜드*']?.trim() || '',
            itemCategory: row['품목*']?.trim() || '',
            product: row['제품']?.trim() || '',
            spec: row['스펙']?.trim() || '',
            quantity: ic_pFloat(row['수량*']), // [수정] Number -> ic_pFloat
            unit: row['단위*']?.trim() || 'kg',
            unitPrice: ic_pFloat(row['단가($)*']), // [수정] Number -> ic_pFloat
            notes: row['비고']?.trim() || ''
        };
        remit.totalAmount = parseFloat((remit.quantity * remit.unitPrice).toFixed(2)); // 소수점 2자리까지 계산

        if (!remit.date || !remit.company || !remit.brand || !remit.itemCategory || remit.quantity <= 0 || remit.unitPrice < 0) {

            console.error(`해외송금 CSV 유효성 검사 실패 (행 ${index + 2}):`, row);
            return null; // 유효하지 않으면 null 반환
        }
        return remittancesCollection.add(remit); // Firestore에 추가하는 Promise 반환
    }, cancelRemittanceCsvUpload, '해외송금');
}

function cancelRemittanceCsvUpload() {
    cancelCsvUpload('remit-csv-file', 'remit-csv-preview', () => { remitCsvData = null; });
}
// END: 해외송금 CSV 관련 함수 추가








/**
 * 매입(국내) 탭의 '총매입(원)'을 자동 계산합니다.
 */
function calculatePurchase() {
    const quantity = Number(document.getElementById('purchase-quantity').value) || 0;
    const unitPrice = Number(document.getElementById('purchase-unit-price').value) || 0;
    const totalAmount = quantity * unitPrice;
    document.getElementById('purchase-total-amount').value = totalAmount;
}

/**
 * 매입(국내) 데이터를 Firestore에 저장하거나 수정합니다.
 * @param {boolean} isEdit - 수정 모드 여부
 */
async function processPurchase(isEdit) {
    const record = {
        date: document.getElementById('purchase-date').value,
        company: document.getElementById('purchase-company').value.trim(),
        brand: document.getElementById('purchase-brand').value.trim(),
        itemCategory: document.getElementById('purchase-item-category').value,
        product: document.getElementById('purchase-product').value.trim(),
        spec: document.getElementById('purchase-spec').value.trim(),
        quantity: Number(document.getElementById('purchase-quantity').value) || 0,
        unit: document.getElementById('purchase-unit').value,
        unitPrice: Number(document.getElementById('purchase-unit-price').value) || 0,
        totalAmount: Number(document.getElementById('purchase-total-amount').value) || 0,
        notes: document.getElementById('purchase-notes').value.trim()
    };

    if (!record.date || !record.company || !record.brand || !record.itemCategory || record.quantity <= 0) {
        return alert('필수 항목(날짜, 업체, 브랜드, 항목, 수량)을 모두 입력해주세요.');
    }

    try {
        if (isEdit && editingPurchaseId) {
            await purchasesCollection.doc(editingPurchaseId).update(record);
            alert('매입 내역이 성공적으로 수정되었습니다.');
        } else {
            await purchasesCollection.add(record);
            alert('매입 내역이 성공적으로 등록되었습니다.');
        }
        cancelPurchaseEdit();
    } catch (error) {
        console.error("매입 데이터 저장/수정 오류:", error);
        alert(`매입 데이터를 처리하는 중 오류가 발생했습니다: ${error.message}`);
    }
}

/**
 * 선택된 매입 내역을 삭제합니다.
 */
async function deleteSelectedPurchases() {
    const selectedIds = Array.from(document.querySelectorAll('.purchase-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length === 0) return alert('삭제할 항목을 선택하세요.');
    if (!confirm(`선택된 ${selectedIds.length}개의 매입 내역을 삭제하시겠습니까?`)) return;
    try {
        if (editingPurchaseId && selectedIds.includes(editingPurchaseId)) {
            cancelPurchaseEdit();
        }
        const batch = db.batch();
        selectedIds.forEach(id => batch.delete(purchasesCollection.doc(id)));
        await batch.commit();
        alert(`${selectedIds.length}개의 매입 내역이 삭제되었습니다.`);
    } catch (error) {
        console.error("매입 데이터 삭제 오류:", error);
        alert("매입 데이터를 삭제하는 중 오류가 발생했습니다.");
    }
}

/**
 * 매입 내역 필터를 적용하고 테이블을 다시 렌더링합니다.
 */
function applyPurchaseFiltersAndRender() {
    const filters = {
        startMonth: document.getElementById('filter-purchase-start-month').value,
        endMonth: document.getElementById('filter-purchase-end-month').value,
        company: document.getElementById('filter-purchase-list-company').value.toLowerCase(),
        brand: document.getElementById('filter-purchase-list-brand').value.toLowerCase(),
        itemCategory: document.getElementById('filter-purchase-list-item-category').value.toLowerCase(),
        product: document.getElementById('filter-purchase-list-product').value.toLowerCase(),
        spec: document.getElementById('filter-purchase-list-spec').value.toLowerCase(),
    };
    const filteredPurchases = purchases.filter(p => {
        const month = p.date.substring(0, 7);
        const startCheck = !filters.startMonth || month >= filters.startMonth;
        const endCheck = !filters.endMonth || month <= filters.endMonth;
        return startCheck && endCheck &&
               (p.company || '').toLowerCase().includes(filters.company) &&
               (p.brand || '').toLowerCase().includes(filters.brand) &&
               (p.itemCategory || '').toLowerCase().includes(filters.itemCategory) &&
               (p.product || '').toLowerCase().includes(filters.product) &&
               (p.spec || '').toLowerCase().includes(filters.spec);
    });
    updatePurchaseTable(filteredPurchases);
}

/**
 * 매입 내역 테이블을 HTML로 렌더링합니다.
 * @param {Array} purchasesToDisplay - 렌더링할 매입 데이터
 */
function updatePurchaseTable(purchasesToDisplay) {
    const tbody = document.getElementById('purchase-tbody');
    if (!tbody) return; // 탭이 로드되지 않았을 수 있음
    tbody.innerHTML = '';
    let totalAmountSum = 0;

    purchasesToDisplay.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(p => {
        totalAmountSum += p.totalAmount || 0;

        const row = tbody.insertRow();
        row.innerHTML = `
            <td><input type="checkbox" class="purchase-checkbox" value="${p.id}"></td>
            <td>${p.date}</td><td>${p.company}</td><td>${p.brand}</td>
            <td>${p.itemCategory}</td><td>${p.product || ''}</td><td>${p.spec || ''}</td>
            <td>${(p.quantity || 0).toLocaleString()} ${p.unit}</td>
            <td>${(p.unitPrice || 0).toLocaleString()}</td>
            <td>${(p.totalAmount || 0).toLocaleString()}</td>
            <td>${p.notes || ''}</td>`;
    });
    
    document.getElementById('total-purchase-list-amount').innerText = totalAmountSum.toLocaleString();
    const selectAllCheckbox = document.getElementById('select-all-purchases');
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
}

/**
 * '선택 수정' 버튼 클릭 시, 매입 내역을 폼에 로드합니다.
 */
function editSelectedPurchase() {
    const selectedIds = Array.from(document.querySelectorAll('.purchase-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length !== 1) return alert('수정할 항목을 하나만 선택하세요.');
    
    const purchase = purchases.find(p => p.id === selectedIds[0]);
    if (!purchase) return alert("오류: 데이터를 찾을 수 없습니다.");
    
    editingPurchaseId = purchase.id;
    document.getElementById('purchase-date').value = purchase.date;
    document.getElementById('purchase-company').value = purchase.company;
    document.getElementById('purchase-brand').value = purchase.brand;
    document.getElementById('purchase-item-category').value = purchase.itemCategory;
    document.getElementById('purchase-product').value = purchase.product || '';
    document.getElementById('purchase-spec').value = purchase.spec || '';
    document.getElementById('purchase-quantity').value = purchase.quantity;
    document.getElementById('purchase-unit').value = purchase.unit;
    document.getElementById('purchase-unit-price').value = purchase.unitPrice;
    document.getElementById('purchase-total-amount').value = purchase.totalAmount;
    document.getElementById('purchase-notes').value = purchase.notes || '';
    
    document.getElementById('purchase-form-title').innerText = '매입 수정';
    document.getElementById('purchase-form-buttons').innerHTML = `
        <button class="btn btn-success" onclick="processPurchase(true)">수정 저장</button>
        <button class="btn btn-secondary" onclick="cancelPurchaseEdit()">취소</button>`;
    window.scrollTo(0, 0);
}

/**
 * 매입(국내) 폼을 초기화합니다.
 */
function cancelPurchaseEdit() {
    editingPurchaseId = null;
    document.getElementById('purchase-form').reset();
    calculatePurchase(); // 0으로 리셋
    document.getElementById('purchase-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('purchase-form-title').innerText = '매입 등록';
    document.getElementById('purchase-form-buttons').innerHTML = `
        <button class="btn btn-primary" onclick="addPurchase()">➕ 매입 등록</button>
        <button class="btn btn-success" onclick="downloadPurchaseCsvTemplate()">📥 CSV 템플릿 다운로드</button>
        <button class="btn btn-warning" onclick="document.getElementById('purchase-csv-file').click()">📤 CSV 대량 등록</button>`;
}

/**
 * 매입(국내) 필터를 초기화합니다.
 */
function resetPurchaseFilters() {
    ['filter-purchase-start-month', 'filter-purchase-end-month', 'filter-purchase-list-company', 'filter-purchase-list-brand', 'filter-purchase-list-item-category', 'filter-purchase-list-product', 'filter-purchase-list-spec']
    .forEach(id => document.getElementById(id).value = '');
    applyPurchaseFiltersAndRender();
}

/**
 * 매입 내역을 CSV 파일로 내보냅니다.
 */
function exportPurchaseCSV() {
    const csvData = purchases.sort((a,b) => new Date(b.date) - new Date(a.date)).map(p => ({
        '날짜': p.date, '업체': p.company, '브랜드': p.brand, '항목': p.itemCategory, '제품': p.product,
        '스펙': p.spec, '수량': p.quantity, '단위': p.unit, '단가(원)': p.unitPrice,
        '총매입(원)': p.totalAmount, '비고': p.notes
    }));
    downloadCSV(Papa.unparse(csvData), '매입(국내)내역');
}

// --- 매입 CSV 관련 함수 ---
function downloadPurchaseCsvTemplate() {
    const headers = ["날짜*", "업체*", "브랜드*", "항목*", "제품", "스펙", "수량*", "단위*", "단가(원)*", "비고"];
    const csv = headers.join(',') + '\n';
    downloadCSV(csv, '매입(국내)_등록_템플릿');
}

function handlePurchaseCsvUpload(event) {
    handleCsvUpload(event, 'purchase-csv-preview', 'purchase-csv-content', (data) => { purchaseCsvData = data; });
}

function processPurchaseCsvUpload() {
    processCsvData(purchaseCsvData, 'purchase-csv-file', (row, index) => {
        const purchase = {
            date: row['날짜*']?.trim() || '',
            company: row['업체*']?.trim() || '',
            brand: row['브랜드*']?.trim() || '',
            itemCategory: row['항목*']?.trim() || '',
            product: row['제품']?.trim() || '',
            spec: row['스펙']?.trim() || '',
            quantity: ic_pFloat(row['수량*']),
            unit: row['단위*']?.trim() || 'kg',
            unitPrice: ic_pFloat(row['단가(원)*']),
            notes: row['비고']?.trim() || ''
        };
        purchase.totalAmount = purchase.quantity * purchase.unitPrice;

        if (!purchase.date || !purchase.company || !purchase.brand || !purchase.itemCategory || purchase.quantity <= 0) {
            console.error(`매입 CSV 유효성 검사 실패 (행 ${index + 2}):`, row);
            return null; // 유효하지 않으면 null 반환
        }
        return purchasesCollection.add(purchase); // Firestore에 추가하는 Promise 반환
    }, cancelPurchaseCsvUpload, '매입(국내)');
}

function cancelPurchaseCsvUpload() {
    cancelCsvUpload('purchase-csv-file', 'purchase-csv-preview', () => { purchaseCsvData = null; });
}
// [추가] END: ================== 4-x. 매입(국내) 탭 관련 함수 ==================

// [추가] START: ================== 5. 현황판 (구. 중요메모장) 탭 함수 ==================
/**
 * 현황판 탭의 3개 필터(매출/매입/메모)를 초기화합니다.
 */
function initializeExpenditureTabFilters() {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = String(today.getMonth() + 1).padStart(2, '0');

    // --- 데이터에서 업체 목록 추출 ---
    // (app.js의 sales, purchases 전역 변수를 사용)
    const salesCompanies = new Set();
    const purchaseCompanies = new Set();
    sales.forEach(r => { if (r.company) salesCompanies.add(r.company); });
    // [연동] 입출고(transactions) 데이터의 업체도 '매출' 업체 목록에 포함
    transactions.forEach(t => { if (t.type === '출고' && t.company) salesCompanies.add(t.company); });
    purchases.forEach(r => { if (r.company) purchaseCompanies.add(r.company); });

    const sortedSalesCompanies = [...salesCompanies].sort();
    const sortedPurchaseCompanies = [...purchaseCompanies].sort();

    // --- 드롭다운 옵션 생성 헬퍼 ---
    const yearOptions = Array.from({length: 10}, (_, i) => currentYear - 5 + i).reverse().map(y => `<option value="${y}">${y}년</option>`).join('');
    const monthOptions = Array.from({length: 12}, (_, i) => `<option value="${String(i+1).padStart(2,'0')}">${i+1}월</option>`).join('');

    const populateYears = (selectId, setDefault = true) => {
        const select = document.getElementById(selectId);
        if (select) {
            select.innerHTML = '<option value="">전체 연도</option>' + yearOptions;
            if (setDefault) select.value = currentYear;
        }
    };
    const populateMonths = (selectId, setDefault = true) => {
        const select = document.getElementById(selectId);
        if (select) {
            select.innerHTML = '<option value="">전체 월</option>' + monthOptions;
            if (setDefault) select.value = currentMonth;
        }
    };

    // --- 1. 메모 필터 채우기 (연/월만) ---
    const memoYear = document.getElementById('exp-memo-filter-year');
    const memoMonth = document.getElementById('exp-memo-filter-month');
    if(memoYear) memoYear.innerHTML = Array.from({length: 10}, (_, i) => currentYear - 5 + i).reverse().map(y => `<option value="${y}">${y}년</option>`).join('');
    if(memoMonth) memoMonth.innerHTML = Array.from({length: 12}, (_, i) => `<option value="${String(i+1).padStart(2,'0')}">${i+1}월</option>`).join('');
    if(memoYear) memoYear.value = currentYear;
    if(memoMonth) memoMonth.value = currentMonth;

    // --- 2. 매출 필터 채우기 (연/월/업체) ---
    populateYears('exp-sales-filter-year', true);
    populateMonths('exp-sales-filter-month', true);
    const salesCompanySelect = document.getElementById('exp-sales-filter-company');
    if (salesCompanySelect) {
        salesCompanySelect.innerHTML = '<option value="">전체 업체</option>' + sortedSalesCompanies.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    // --- 3. 매입 필터 채우기 (연/월/업체) ---
    populateYears('exp-purchase-filter-year', true);
    populateMonths('exp-purchase-filter-month', true);
    const purchaseCompanySelect = document.getElementById('exp-purchase-filter-company');
    if (purchaseCompanySelect) {
        purchaseCompanySelect.innerHTML = '<option value="">전체 업체</option>' + sortedPurchaseCompanies.map(c => `<option value="${c}">${c}</option>`).join('');
    }
}

/**
 * 현황판의 3개 뷰(매출/매입/메모)를 모두 새로고침합니다.
 */
function renderAllExpenditureViews() {
    // 필터 드롭다운의 업체 목록도 업데이트 (새 업체가 추가되었을 수 있으므로)
    initializeExpenditureTabFilters(); 

    // 3개 컴포넌트 렌더링
    renderSalesTotal();
    renderPurchaseTotal();
    renderExpenditureMemo();
}

/**
 * [연동] 월별 매출 총 금액 계산 (입출고(출고) + 일반매출)
 */
function renderSalesTotal() {
    const year = document.getElementById('exp-sales-filter-year').value;
    const month = document.getElementById('exp-sales-filter-month').value;
    const company = document.getElementById('exp-sales-filter-company').value;

    // 날짜 필터 로직
    const dateFilter = (item) => {
        let dateMatch = true;
        if (year && month) dateMatch = item.date.startsWith(`${year}-${month}`);
        else if (year) dateMatch = item.date.startsWith(year);
        else if (month) dateMatch = item.date.substring(5, 7) === month;
        return dateMatch;
    };
    // 업체 필터 로직
    const companyFilter = (item) => !company || item.company === company;

    // 1. [연동] '입출고 현황(transactions)' 중 '출고' 데이터 합산
    const totalFromTransactions = transactions
        .filter(t => t.type === '출고')
        .filter(dateFilter)
        .filter(companyFilter)
        .reduce((sum, t) => sum + (t.totalSales || 0), 0);

    // 2. [연동] '일반 매출(sales)' 데이터 합산
    const totalFromSales = sales
        .filter(dateFilter)
        .filter(companyFilter)
        .reduce((sum, s) => sum + (s.totalSales || 0), 0);

    // 3. 두 합계 더하기
    const totalSales = totalFromTransactions + totalFromSales;
    document.getElementById('exp-total-sales').textContent = `${Math.round(totalSales).toLocaleString()} 원`;
}

/**
 * [연동] 월별 매입 총 금액 계산 (매입(국내))
 */
function renderPurchaseTotal() {
    const year = document.getElementById('exp-purchase-filter-year').value;
    const month = document.getElementById('exp-purchase-filter-month').value;
    const company = document.getElementById('exp-purchase-filter-company').value;

    // 1. [연동] '매입(국내)(purchases)' 데이터 합산
    const filteredPurchase = purchases.filter(p => {
        let dateMatch = true;
        if (year && month) dateMatch = p.date.startsWith(`${year}-${month}`);
        else if (year) dateMatch = p.date.startsWith(year);
        else if (month) dateMatch = p.date.substring(5, 7) === month;

        const companyMatch = !company || p.company === company;
        return dateMatch && companyMatch;
    });

    // 2. 합계 계산
    const totalPurchase = filteredPurchase.reduce((sum, p) => sum + (p.totalAmount || 0), 0);
    document.getElementById('exp-total-purchase').textContent = `${Math.round(totalPurchase).toLocaleString()} 원`;
}

/**
 * 월별 간단 메모 렌더링 (전역 변수 expenditureMemos 사용)
 */
function renderExpenditureMemo() {
    const yearSelect = document.getElementById('exp-memo-filter-year');
    const monthSelect = document.getElementById('exp-memo-filter-month');
    if (!yearSelect || !monthSelect) return; 

    const year = yearSelect.value;
    const month = monthSelect.value;
    const monthKey = `${year}-${month}`; // 예: '2025-10'

    const notesListEl = document.getElementById('exp-notes-list');
    notesListEl.innerHTML = '';
    const notes = expenditureMemos[monthKey] || []; // 전역 변수에서 해당 월의 메모 배열 가져오기

    notes.forEach((note, index) => {
        notesListEl.innerHTML += `
            <div class="note-item">
                <span>${note}</span>
                <button onclick="deleteExpenditureNote(${index})">&times;</button>
            </div>
        `;
    });
}

/**
 * 새 간단 메모를 Firebase에 추가
 */
async function addExpenditureNote() {
    const year = document.getElementById('exp-memo-filter-year').value;
    const month = document.getElementById('exp-memo-filter-month').value;
    const monthKey = `${year}-${month}`; // 문서 ID

    const inputEl = document.getElementById('exp-new-note-input');
    const newNote = inputEl.value.trim();
    if (!newNote) return;

    // Firebase에서 현재 월의 메모 배열 가져오기 (없으면 빈 배열)
    const currentNotes = expenditureMemos[monthKey] || [];
    // 새 메모 추가
    const updatedNotes = [...currentNotes, newNote];

    try {
        // Firebase의 'YYYY-MM' 문서를 새 배열로 덮어쓰기 (set)
        await expenditureMemosCollection.doc(monthKey).set({ notes: updatedNotes });
        // 성공 시 UI 즉시 업데이트 (onSnapshot이 처리하지만, 빠른 반응을 위해 수동 호출)
        renderExpenditureMemo(); 
        inputEl.value = '';
    } catch (error) {
        console.error("현황판 메모 추가 오류:", error);
        alert("메모 추가 중 오류가 발생했습니다.");
    }
}

/**
 * 간단 메모를 Firebase에서 삭제
 */
async function deleteExpenditureNote(index) {
    const year = document.getElementById('exp-memo-filter-year').value;
    const month = document.getElementById('exp-memo-filter-month').value;
    const monthKey = `${year}-${month}`;

    // 전역 변수에서 현재 메모 배열 가져오기
    const currentNotes = expenditureMemos[monthKey] || [];

    if (currentNotes[index] === undefined) return;

    if (confirm(`"${currentNotes[index]}" 메모를 삭제하시겠습니까?`)) {
        // 해당 인덱스만 제외하고 새 배열 만들기
        const updatedNotes = currentNotes.filter((_, i) => i !== index);

        try {
            // Firebase 문서를 새 배열로 덮어쓰기
            await expenditureMemosCollection.doc(monthKey).set({ notes: updatedNotes });
            // 성공 시 UI 즉시 업데이트
            renderExpenditureMemo();
        } catch (error) {
            console.error("현황판 메모 삭제 오류:", error);
            alert("메모 삭제 중 오류가 발생했습니다.");
        }
    }
}
// [추가] END: ================== 5. 현황판 (구. 중요메모장) 탭 함수 ==================



// ================== 4-3. 거래명세서/청구서 ==================
// START: generateInvoice 함수 교체 (빈 줄 제거)

function generateInvoice() {
    const recipientCompany = document.getElementById('recipient-company').value.trim();
    const startDate = document.getElementById('invoice-start-date').value;
    const endDate = document.getElementById('invoice-end-date').value;
    const transactionType = document.getElementById('invoice-transaction-type').value;

    if (!recipientCompany || !startDate || !endDate) {
        return alert('(*) 필수 항목(회사명, 날짜 범위)을 입력해주세요.');
    }

    // 1. 입출고 데이터 필터링
    const filteredTransactions = transactions.filter(t => {
        return new Date(t.date) >= new Date(startDate) && new Date(t.date) <= new Date(endDate) &&
               (transactionType === 'all' || t.type === transactionType) &&
               t.company.trim().toLowerCase() === recipientCompany.toLowerCase();
    });

    // 2. 매출 데이터 필터링 (출고 또는 전체 선택 시에만)
    const filteredSales = (transactionType === 'all' || transactionType === '출고')
        ? sales.filter(s => {
              return new Date(s.date) >= new Date(startDate) && new Date(s.date) <= new Date(endDate) &&
                     s.company.trim().toLowerCase() === recipientCompany.toLowerCase();
          })
        : [];

    // 3. 데이터 병합 및 정렬
    let combinedItems = [];
   
    filteredTransactions.forEach(t => combinedItems.push({
    isTransaction: true, // 데이터 출처 구분
    date: t.date, brand: t.brand, product: t.product, spec: t.spec, lot: t.lot,
    unit: 'kg', quantity: t.weight, unitPrice: t.sellingPrice, notes: t.notes, destination: t.destination // <-- t.unitPrice -> t.sellingPrice 변경
}));

    filteredSales.forEach(s => combinedItems.push({
        isTransaction: false, // 데이터 출처 구분
        date: s.date, brand: s.brand, product: s.product, spec: s.spec, lot: '', // 매출엔 LOT 없음
        unit: s.unit, quantity: s.quantity, unitPrice: s.sellingPrice, notes: s.notes, destination: '' // 매출엔 도착지 없음
    }));

    combinedItems.sort((a, b) => new Date(a.date) - new Date(b.date)); // 날짜순 정렬

    if (combinedItems.length === 0) {
        alert('해당 조건에 맞는 거래 또는 매출 내역이 없습니다.');
        return document.getElementById('invoice-wrapper').style.display = 'none';
    }

    const today = new Date().toISOString().split('T')[0];
    let totalAmount = 0; // 총 금액 계산용

    // 4. HTML 생성 (데이터 출처에 따라 약간 다르게 표시 가능)
    const itemsHtml = combinedItems.map(item => {
        const amount = item.quantity * item.unitPrice;
        totalAmount += amount; // 합계 계산
        // 매출 데이터는 단가 편집 불가, 입출고는 가능하도록 설정
        const priceEditable = item.isTransaction ? 'contenteditable="true"' : '';
        const quantityDisplay = item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
        const unitPriceDisplay = item.unitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 });
        const amountDisplay = Math.round(amount).toLocaleString(); // 금액은 반올림

        return `<tr class="invoice-item-row">
            <td contenteditable="true">${item.date}</td>
            <td contenteditable="true">${item.brand || ''}</td>
            <td contenteditable="true">${item.product || ''}</td>
            <td contenteditable="true">${item.spec || ''}</td>
            <td contenteditable="true">${item.lot || ''}</td>
            <td contenteditable="true">${item.unit}</td>
            <td contenteditable="true" class="invoice-quantity">${quantityDisplay}</td>
            <td ${priceEditable} class="invoice-price">${unitPriceDisplay}</td>
            <td class="invoice-amount">${amountDisplay}</td>
            <td contenteditable="true">${item.notes || ''}</td>
            <td><button class="btn btn-danger btn-sm no-print" onclick="this.closest('tr').remove(); updateInvoiceTotals();">X</button></td>
        </tr>`;
    }).join('');
    
    // 이전에 빈 줄을 추가하던 로직을 삭제함
    const firstDestination = filteredTransactions.find(t => t.destination)?.destination || document.getElementById('recipient-address').value || ''; // 주소 우선순위

    // 5. 최종 HTML 렌더링 (테이블 컬럼 개수 맞추기: 11개)
    document.getElementById('invoice-content').innerHTML = `
        <div class="invoice-header"><h2 class="invoice-title">거래명세표</h2></div>
        <div class="invoice-info">
            <div class="invoice-box"><table><tr><td class="label-td" rowspan="3" style="padding:15px 0;">공<br>급<br>자</td><td class="label-td">사업자번호</td><td>101-02-35223</td></tr><tr><td class="label-td">상호</td><td>그루텍스</td></tr><tr><td class="label-td">주소</td><td>서울시 도봉구 노해로 397-15 백상빌딩 1005호</td></tr></table></div>
            <div class="invoice-box"><table><tr><td class="label-td" rowspan="3" style="padding:15px 0;">공<br>급<br>받<br>는<br>자</td><td class="label-td">사업자번호</td><td contenteditable="true">${document.getElementById('recipient-reg-no').value}</td></tr><tr><td class="label-td">상호</td><td contenteditable="true">${recipientCompany}</td></tr><tr><td class="label-td">주소</td><td contenteditable="true">${document.getElementById('recipient-address').value}</td></tr></table></div>
        </div>
        <div class="invoice-items">
            <table id="invoice-items-table">
                <thead>
                    <tr><th colspan="11" style="text-align:left; padding-left:10px;">작성일자: ${today}</th></tr>
                    <tr><th>날짜</th><th>브랜드</th><th>제품</th><th>스펙</th><th>LOT</th><th>단위</th><th>수량</th><th>단가</th><th>금액</th><th>비고</th><th class="no-print" style="width: 50px;">삭제</th></tr>
                </thead>
                <tbody id="invoice-tbody">${itemsHtml}</tbody>
                <tfoot>
                    <tr><td colspan="8" style="text-align: right; font-weight: bold;">총 합계 금액</td><td id="invoice-total-amount" style="text-align: right; font-weight: bold;">${Math.round(totalAmount).toLocaleString()}</td><td colspan="2"></td></tr>
                </tfoot>
            </table>
        </div>
        <div class="invoice-footer"><table><tr><td style="width:15%; text-align:center; font-weight:bold; background-color:#f2f2f2;">도착지</td><td contenteditable="true" style="text-align:left; padding-left:10px;">${firstDestination}</td></tr></table></div>
        <div class="invoice-footer"><table><tr><td style="width:15%; text-align:center; font-weight:bold; background-color:#f2f2f2;">비 고</td><td contenteditable="true" style="height: 80px; text-align:left; vertical-align:top; padding: 5px;"></td></tr></table></div>
        <div class="invoice-company-info" style="margin-top: 30px; padding: 15px; border-top: 2px solid #333; text-align: center;"><div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px; border-radius: 8px; margin-bottom: 10px;"><span style="font-size: 18px; font-weight: bold; letter-spacing: 3px;">그루텍스</span><span style="font-size: 16px; margin-left: 10px;">| GROOOTEX</span></div><div style="font-size: 11px; color: #333; line-height: 1.4;"><p style="font-weight: bold; margin-bottom: 5px;">#1002, 10F, Backsang building, 397-15, Nohae-ro, Dobong-gu, Seoul, Korea (01415)</p><p>Tel: 82 2 997 8566  Fax: 82 2 997 4888  e-mail: groootex@groootex.com</p></div></div>`;

    document.getElementById('invoice-wrapper').style.display = 'block';
    // 이벤트 리스너 추가 (동적 업데이트용)
    const invoiceTable = document.getElementById('invoice-items-table');
    if (invoiceTable) {
        invoiceTable.removeEventListener('input', handleInvoiceTableInput); // 기존 리스너 제거
        invoiceTable.addEventListener('input', handleInvoiceTableInput); // 새 리스너 추가
    }
}
// END: generateInvoice 함수 교체


function printInvoice() { window.print(); }

function saveInvoiceAsPDF() {
    html2pdf(document.getElementById('invoice-content'), {
        margin: 10, filename: '거래명세표.pdf', image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    });

}

// START: 거래명세표 행 추가 및 합계 계산 함수 추가
function addInvoiceItemRow() {
    const tbody = document.getElementById('invoice-tbody'); // ID 확인: invoice-items-table tbody
    if (!tbody) return;
    const newRow = tbody.insertRow();
    newRow.className = 'invoice-item-row';
    // 컬럼 개수 11개에 맞춤 (삭제 버튼 포함)
    newRow.innerHTML = `
        <td contenteditable="true">${new Date().toISOString().slice(0,10)}</td>
        <td contenteditable="true"></td><td contenteditable="true"></td>
        <td contenteditable="true"></td><td contenteditable="true"></td>
        <td contenteditable="true">kg</td>
        <td contenteditable="true" class="invoice-quantity">0</td>
        <td contenteditable="true" class="invoice-price">0</td>
        <td class="invoice-amount">0</td>
        <td contenteditable="true"></td>
        <td class="no-print"><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); updateInvoiceTotals();">X</button></td>`;
    newRow.cells[1].focus(); // 첫 번째 편집 가능한 셀에 포커스
    updateInvoiceTotals(); // 행 추가 후 합계 재계산
}

function updateInvoiceRowTotal(cell) {
    const row = cell.closest('tr');
    if (!row) return;
    // 셀 인덱스 확인: 수량(6), 단가(7), 금액(8)
    const qtyText = row.cells[6].innerText;
    const qty = parseFloat(qtyText.replace(/[^0-9.-]+/g,"")) || 0; // 단위 무시 숫자 추출
    const price = parseFloat(row.cells[7].innerText.replace(/,/g, '')) || 0;
    row.cells[8].innerText = Math.round(qty * price).toLocaleString(); // 금액 셀 업데이트
    updateInvoiceTotals(); // 전체 합계 재계산
}

function updateInvoiceTotals() {
    const tbody = document.getElementById('invoice-tbody'); // ID 확인: invoice-items-table tbody
    if (!tbody) return;
    let totalAmount = 0;
    tbody.querySelectorAll('tr').forEach(row => {
        // 셀 인덱스 확인: 금액(8)
        totalAmount += parseFloat(row.cells[8].innerText.replace(/,/g, '')) || 0; // 행 금액 사용
    });
    const totalAmountElement = document.getElementById('invoice-total-amount');
    if (totalAmountElement) {
        totalAmountElement.innerText = Math.round(totalAmount).toLocaleString();
    }
}
// END: 거래명세표 행 추가 및 합계 계산 함수 추가


// START: generateBill 함수 교체
function generateBill() {
    document.getElementById('invoice-wrapper').style.display = 'none'; // 명세서 숨기기
    const recipientCompany = document.getElementById('recipient-company').value.trim();
    const startDate = document.getElementById('invoice-start-date').value;
    const endDate = document.getElementById('invoice-end-date').value;
    const transactionType = document.getElementById('invoice-transaction-type').value; // 명세서와 동일한 필터 사용

    if (!recipientCompany || !startDate || !endDate) {
        return alert('(*) 필수 항목(회사명, 날짜 범위)을 입력해주세요.');
    }

    // 1. 입출고 데이터 필터링 (청구서는 보통 출고 기준이나, 명세서 필터를 따름)
    const filteredTransactions = transactions.filter(t => {
        return new Date(t.date) >= new Date(startDate) && new Date(t.date) <= new Date(endDate) &&
               (transactionType === 'all' || t.type === transactionType) && // 명세서 필터 존중
               t.company.trim().toLowerCase() === recipientCompany.toLowerCase();
    });

    // 2. 매출 데이터 필터링 (출고 또는 전체 선택 시)
    const filteredSales = (transactionType === 'all' || transactionType === '출고')
        ? sales.filter(s => {
              return new Date(s.date) >= new Date(startDate) && new Date(s.date) <= new Date(endDate) &&
                     s.company.trim().toLowerCase() === recipientCompany.toLowerCase();
          })
        : [];

    // 3. 데이터 병합 및 정렬 (입고는 음수 수량으로 처리하여 합계 계산)
    let combinedItems = [];

   filteredTransactions.forEach(t => combinedItems.push({
    isTransaction: true,
    date: t.date, brand: t.brand, product: t.product, spec: t.spec, lot: t.lot, unit: 'kg',
    quantity: t.type === '입고' ? -t.weight : t.weight, // 입고는 음수로
    unitPrice: t.sellingPrice, notes: t.notes // <-- t.unitPrice -> t.sellingPrice 변경
}));

    filteredSales.forEach(s => combinedItems.push({
        isTransaction: false,
        date: s.date, brand: s.brand, product: s.product, spec: s.spec, lot: '', unit: s.unit,
        quantity: s.quantity, unitPrice: s.sellingPrice, notes: s.notes
    }));

    combinedItems.sort((a, b) => new Date(a.date) - new Date(b.date)); // 날짜순 정렬

    // 입고 포함 시 청구서 의미가 모호해질 수 있음을 알림 (선택사항)
    if (transactionType === 'all' && filteredTransactions.some(t => t.type === '입고')) {
         console.warn("청구서에 '입고' 내역이 포함되었습니다. 금액 계산에 유의하세요.");
    }

    // 4. HTML 생성
    const itemsHtml = combinedItems.map(item => {
        // 입고(음수 수량)는 금액 계산 시 제외하거나 표시만 할 수 있음. 여기선 계산에 포함.
        const subtotal = item.quantity * item.unitPrice;
        const priceEditable = item.isTransaction ? 'contenteditable="true"' : ''; // 매출 단가는 편집 불가
        const quantityDisplay = item.quantity.toLocaleString(undefined, { maximumFractionDigits: 2 });
        const unitPriceDisplay = item.unitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 });

        return `<tr class="bill-item-row">
            <td contenteditable="true">${item.date}</td><td contenteditable="true">${item.brand || ''}</td>
            <td contenteditable="true">${item.product || ''}</td><td contenteditable="true">${item.spec || ''}</td>
            <td contenteditable="true">${item.lot || ''}</td><td contenteditable="true">${item.unit}</td>
            <td contenteditable="true" class="bill-quantity" oninput="calculateRowAndTotal(this)">${quantityDisplay}</td>
            <td ${priceEditable} class="bill-price" oninput="calculateRowAndTotal(this)">${unitPriceDisplay}</td>
            <td class="row-total">${Math.round(subtotal).toLocaleString()}</td>
            <td contenteditable="true">${item.notes || ''}</td>
            <td class="no-print"><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); calculateBillTotals();">X</button></td>
        </tr> `}).join('');

    const billWrapper = document.getElementById('bill-wrapper');
    // 5. 최종 HTML 렌더링 (테이블 컬럼 개수 맞추기: 11개)
    billWrapper.innerHTML = `
        <div id="bill-controls" class="btn-group no-print" style="justify-content: flex-end; margin-bottom: 15px;">
            <button class="btn btn-info btn-sm" onclick="addBillItemRow()">➕ 항목 추가</button>
            <button class="btn btn-primary btn-sm" onclick="printBill()">🖨️ 인쇄</button>
            <button class="btn btn-warning btn-sm" onclick="saveBillAsPDF()">📄 PDF로 저장</button>
        </div>
        <div id="bill-content" class="invoice">
            <div class="invoice-header"><h2 class="invoice-title">청 구 서</h2></div>
            <div class="invoice-info">
                <div class="invoice-box"><table><tr><td class="label-td" rowspan="3" style="padding:15px 0;">공<br>급<br>자</td><td class="label-td">사업자번호</td><td>101-02-35223</td></tr><tr><td class="label-td">상호</td><td>그루텍스</td></tr><tr><td class="label-td">주소</td><td>서울시 도봉구 노해로 397-15 백상빌딩 1005호</td></tr></table></div>
                <div class="invoice-box"><table><tr><td class="label-td" rowspan="3" style="padding:15px 0;">공<br>급<br>받<br>는<br>자</td><td class="label-td">사업자번호</td><td contenteditable="true">${document.getElementById('recipient-reg-no').value}</td></tr><tr><td class="label-td">상호</td><td contenteditable="true">${recipientCompany} 귀하</td></tr><tr><td class="label-td">주소</td><td contenteditable="true">${document.getElementById('recipient-address').value}</td></tr></table></div>
            </div>
            <div class="invoice-items">
                <table id="bill-items-table">
                    <thead><tr><th>날짜</th><th>브랜드</th><th>제품</th><th>스펙</th><th>LOT</th><th>단위</th><th>수량</th><th>단가</th><th>합계</th><th>비고</th><th class="no-print" style="width: 50px;">삭제</th></tr></thead>
                    <tbody id="bill-tbody">${itemsHtml}</tbody>
                    <tfoot>
                        <tr><td colspan="6" style="text-align: right; font-weight: bold;">수량 합계</td><td id="bill-total-quantity" style="text-align: right; font-weight: bold;">0</td><td colspan="4"></td></tr>
                        <tr><td colspan="8" style="text-align: right; font-weight: bold;">공급가액 (합계)</td><td id="bill-subtotal" style="text-align: right; font-weight: bold;">0</td><td colspan="2"></td></tr>
                        <tr><td colspan="8" style="text-align: right; font-weight: bold;">부가가치세 (VAT)</td><td id="bill-vat" style="text-align: right; font-weight: bold;">0</td><td colspan="2"></td></tr>
                        <tr><td colspan="8" style="text-align: right; font-weight: bold; background-color: #f2f2f2;">총 청구금액</td><td id="bill-total" style="text-align: right; font-weight: bold; background-color: #f2f2f2;">0</td><td colspan="2"></td></tr>
                    </tfoot>
                </table>
            </div>
            <div class="invoice-footer"><table><tr><td style="width:15%; text-align:center; font-weight:bold; background-color:#f2f2f2;">비 고</td><td contenteditable="true" style="height: 80px; text-align:left; vertical-align:top; padding: 5px;">은행정보: 하나은행 / 이선용(그루텍스) 221-890021-48404</td></tr></table></div>
            <div class="invoice-company-info" style="margin-top: 30px; padding: 15px; border-top: 2px solid #333; text-align: center;"><div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 10px; border-radius: 8px; margin-bottom: 10px;"><span style="font-size: 18px; font-weight: bold; letter-spacing: 3px;">그루텍스</span><span style="font-size: 16px; margin-left: 10px;">| GROOOTEX</span></div><div style="font-size: 11px; color: #333; line-height: 1.4;"><p style="font-weight: bold; margin-bottom: 5px;">#1002, 10F, Backsang building, 397-15, Nohae-ro, Dobong-gu, Seoul, Korea (01415)</p><p>Tel: 82 2 997 8566  Fax: 82 2 997 4888  e-mail: groootex@groootex.com</p></div></div>
        </div>`;

    billWrapper.style.display = 'block';
    calculateBillTotals(); // 초기 합계 계산
    // 이벤트 리스너 추가 (동적 업데이트용)
    const billTable = document.getElementById('bill-items-table');
     if (billTable) {
        billTable.removeEventListener('input', handleBillTableInput); // 기존 리스너 제거
        billTable.addEventListener('input', handleBillTableInput); // 새 리스너 추가
    }
}
// END: generateBill 함수 교체

// START: 청구서 테이블 입력 핸들러 추가
function handleBillTableInput(event) {
    // 수량 또는 단가 셀이 변경되었을 때만 계산 실행
    if (event.target.classList.contains('bill-quantity') || event.target.classList.contains('bill-price')) {
        calculateRowAndTotal(event.target);
    }
}
// END: 청구서 테이블 입력 핸들러 추가

// START: 거래명세서 테이블 입력 핸들러 추가
function handleInvoiceTableInput(event) {
    // 수량 또는 단가 셀이 변경되었을 때만 계산 실행
    if (event.target.classList.contains('invoice-quantity') || event.target.classList.contains('invoice-price')) {
        updateInvoiceRowTotal(event.target);
    }
}
// END: 거래명세서 테이블 입력 핸들러 추가


function printBill() { window.print(); }
function saveBillAsPDF() {
    html2pdf(document.getElementById('bill-content'), {
        margin: 10, filename: '청구서.pdf', image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    });

}

// START: calculateRowAndTotal 함수 교체
function calculateRowAndTotal(cell) {
    const row = cell.closest('tr');
    if (!row) return;
    // 셀 인덱스 확인: 수량(6), 단가(7), 합계(8)
    const qtyText = row.cells[6].innerText;
    const qty = parseFloat(qtyText.replace(/[^0-9.-]+/g,"")) || 0; // 단위 무시하고 숫자만 추출
    const price = parseFloat(row.cells[7].innerText.replace(/,/g, '')) || 0;
    row.cells[8].innerText = Math.round(qty * price).toLocaleString(); // 합계 셀 업데이트
    calculateBillTotals(); // 전체 합계 재계산
}
// END: calculateRowAndTotal 함수 교체


// START: calculateBillTotals 함수 교체
function calculateBillTotals() {
    const tbody = document.getElementById('bill-tbody'); // ID 확인: bill-items-table tbody
    if (!tbody) return;
    let subtotal = 0, totalQty = 0;
    tbody.querySelectorAll('tr').forEach(row => {
        // 셀 인덱스 확인: 수량(6), 합계(8)
        totalQty += parseFloat(row.cells[6].innerText.replace(/[^0-9.-]+/g,"")) || 0; // 수량에서 숫자만 추출
        subtotal += parseFloat(row.cells[8].innerText.replace(/,/g, '')) || 0; // 행 합계 사용
    });
    const vat = subtotal * 0.1;
    document.getElementById('bill-total-quantity').innerText = totalQty.toLocaleString(undefined, { maximumFractionDigits: 2 });
    document.getElementById('bill-subtotal').innerText = Math.round(subtotal).toLocaleString();
    document.getElementById('bill-vat').innerText = Math.round(vat).toLocaleString();
    document.getElementById('bill-total').innerText = Math.round(subtotal + vat).toLocaleString();
}
// END: calculateBillTotals 함수 교체


// START: addBillItemRow 함수 교체
function addBillItemRow() {
    const tbody = document.getElementById('bill-tbody'); // ID 확인: bill-items-table tbody
    if (!tbody) return;
    const newRow = tbody.insertRow();
    newRow.className = 'bill-item-row';
    // 컬럼 개수 11개에 맞춤 (삭제 버튼 포함)
    newRow.innerHTML = `
        <td contenteditable="true">${new Date().toISOString().slice(0,10)}</td>
        <td contenteditable="true"></td><td contenteditable="true"></td>
        <td contenteditable="true"></td><td contenteditable="true"></td>
        <td contenteditable="true">kg</td>
        <td contenteditable="true" class="bill-quantity" oninput="calculateRowAndTotal(this)">0</td>
        <td contenteditable="true" class="bill-price" oninput="calculateRowAndTotal(this)">0</td>
        <td class="row-total">0</td>
        <td contenteditable="true"></td>
        <td class="no-print"><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); calculateBillTotals();">X</button></td>`;
    newRow.cells[1].focus(); // 첫 번째 편집 가능한 셀에 포커스
    calculateBillTotals(); // 행 추가 후 합계 재계산
}
// END: addBillItemRow 함수 교체

function toggleAllCheckboxes(className, checked) {
    document.querySelectorAll(`.${className}`).forEach(checkbox => checkbox.checked = checked);
}

// ================== 수입원가 정산서 스크립트 (ic_ 함수) ==================
function ic_formatInputForDisplay(input) {
    const value = ic_pFloat(input.value);
    if (!isNaN(value) && input.value.trim() !== '') {
        input.value = value.toLocaleString('en-US', { maximumFractionDigits: 10 });
    }
}
function ic_addItemRow() {
    const tbody = document.getElementById('item-tbody');
    const newRow = tbody.insertRow();
    newRow.innerHTML = `<td><input type="text" class="item-name" oninput="ic_calculateAll()"></td><td><input type="text" class="item-lot" oninput="ic_calculateAll()"></td><td><input type="text" class="item-qty" oninput="ic_calculateAll()" onblur="ic_formatInputForDisplay(this)"></td><td><input type="text" class="item-unit" oninput="ic_calculateAll()"></td><td><input type="text" class="item-price" oninput="ic_calculateAll()" onblur="ic_formatInputForDisplay(this)"></td><td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); ic_calculateAll();">-</button></td>`;
}
function ic_clearForm() {
    ic_editingId = null;
    document.getElementById('ic-cost-form').reset();
    document.getElementById('item-tbody').innerHTML = '';
    document.getElementById('result-tbody').innerHTML = '';
    document.getElementById('total-invoice-value').textContent = '$0.00';
    ic_addItemRow();
    document.getElementById('ic-form-title').textContent = '수입 정산 등록';
    document.getElementById('ic-submit-btn').textContent = '정산서 등록';
    document.getElementById('ic-submit-btn').onclick = () => ic_processCostSheet(false);
    document.getElementById('ic-cancel-btn').style.display = 'none';
}
function ic_resetFilters() {
    ['filter-ic-start-date', 'filter-ic-end-date', 'filter-shipper', 'filter-item', 'filter-lot'].forEach(id => document.getElementById(id).value = '');
    ic_renderList();
}
function ic_calculateAll() {
    let totalInvoiceValue = 0;
    const items = [];
    document.querySelectorAll('#item-tbody tr').forEach(row => {
        const item = { name: row.querySelector('.item-name').value.trim(), lot: row.querySelector('.item-lot').value.trim(), qty: ic_pFloat(row.querySelector('.item-qty').value), unit: row.querySelector('.item-unit').value.trim(), price: ic_pFloat(row.querySelector('.item-price').value) };
        totalInvoiceValue += item.qty * item.price;
        items.push(item);
    });
    document.getElementById('total-invoice-value').textContent = '$' + totalInvoiceValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    const exchangeRate = ic_pFloat(document.getElementById('form-exchange-rate').value), shippingFee = ic_pFloat(document.getElementById('form-shipping-fee').value), tariffAmount = ic_pFloat(document.getElementById('form-tariff-amount').value), fFee1 = ic_pFloat(document.getElementById('form-forwarder-fee1').value), fFee2 = ic_pFloat(document.getElementById('form-forwarder-fee2').value), fFee3 = ic_pFloat(document.getElementById('form-forwarder-fee3').value);
    const invoiceKrw = totalInvoiceValue * exchangeRate, totalMaterialCost = invoiceKrw + shippingFee, tariffCost = tariffAmount, totalForwarderFee = fFee1 + fFee2 + fFee3, grandTotal = totalMaterialCost + tariffCost + totalForwarderFee;
    
    const resultTbody = document.getElementById('result-tbody');
    resultTbody.innerHTML = '';
    items.forEach(item => {
        let unitCost = (totalInvoiceValue > 0 && item.qty > 0) ? (grandTotal * ((item.qty * item.price) / totalInvoiceValue)) / item.qty : 0;
        const newRow = resultTbody.insertRow();
        newRow.innerHTML = `<td>${item.name || 'N/A'}</td> <td>${item.lot || 'N/A'}</td> <td>${item.qty.toLocaleString()}</td> <td>${item.unit || 'N/A'}</td> <td>$${(item.qty * item.price).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td> <td class="highlight calculated-field">₩${Math.round(unitCost).toLocaleString()}</td>`;
    });
}
function ic_renderList() {
    const tbody = document.getElementById('cost-list-tbody');
    tbody.innerHTML = '';
    const filters = { start: document.getElementById('filter-ic-start-date').value, end: document.getElementById('filter-ic-end-date').value, shipper: document.getElementById('filter-shipper').value.toLowerCase(), item: document.getElementById('filter-item').value.toLowerCase(), lot: document.getElementById('filter-lot').value.toLowerCase() };
    const filtered = ic_costSheets.filter(sheet => {
        const etdDate = sheet.etd ? new Date(sheet.etd) : null;
        return (!filters.start || (etdDate && etdDate >= new Date(filters.start))) &&
               (!filters.end || (etdDate && etdDate <= new Date(filters.end))) &&
               sheet.shipper.toLowerCase().includes(filters.shipper) &&
               (!filters.item || sheet.items.some(item => (item.name || item.itemName).toLowerCase().includes(filters.item))) &&
               (!filters.lot || sheet.items.some(item => item.lot.toLowerCase().includes(filters.lot)));
    }).sort((a,b) => (b.etd || '').localeCompare(a.etd || ''));

    filtered.forEach(sheet => {
        sheet.items.forEach((item, index) => {
            const row = tbody.insertRow();
            if (index === 0) row.innerHTML = `<td rowspan="${sheet.items.length}" style="text-align:center;"><input type="checkbox" class="sheet-checkbox" value="${sheet.id}"></td> <td rowspan="${sheet.items.length}">${sheet.eta || ''}</td> <td rowspan="${sheet.items.length}">${sheet.shipper}</td>`;
            row.innerHTML += `<td>${item.name || item.itemName}</td><td>${item.lot}</td><td>${(item.qty || 0).toLocaleString()} ${item.unit}</td> <td>$${(item.price || 0).toLocaleString()}</td><td>${sheet.terms}</td> <td>${sheet.origin}</td> <td>${sheet.method}</td><td>${sheet.cbm}</td> <td>${sheet.packing || ''}</td> <td>${sheet.tariffRate || 0}%</td><td>${ic_pFloat(sheet.exchangeRate).toLocaleString()}</td> <td class="highlight">₩${Math.round(item.unitCost || 0).toLocaleString()}</td>`;
        });
    });
}
function ic_editSelectedSheet() {
    const selectedIds = Array.from(document.querySelectorAll('.sheet-checkbox:checked')).map(cb => cb.value);
    if (selectedIds.length !== 1) return alert('수정할 항목을 하나만 선택하세요.');
    const sheet = ic_costSheets.find(s => s.id === selectedIds[0]);
    if (!sheet) return;
    ic_editingId = sheet.id;
    ['shipper', 'terms', 'origin', 'method', 'etd', 'eta', 'cbm'].forEach(key => document.getElementById(`form-${key}`).value = sheet[key] || '');
    document.getElementById('form-packing').value = sheet.packing || sheet.packaging || '';
    document.getElementById('form-exchange-rate').value = sheet.exchangeRate || '';
    document.getElementById('form-shipping-fee').value = sheet.shippingFee || sheet.bankFee || '';
    document.getElementById('form-tariff-rate').value = sheet.tariffRate || sheet.customsRate || '';
    document.getElementById('form-tariff-amount').value = sheet.tariffAmount || sheet.customsDuty || '';
    document.getElementById('form-vat-amount').value = sheet.vatAmount || sheet.vat || '';
    document.getElementById('form-forwarder-fee1').value = sheet.forwarderFee1 || sheet.localTotalCost || '';
    document.getElementById('form-forwarder-fee2').value = sheet.forwarderFee2 || sheet.importTotalCost || '';
    document.getElementById('form-forwarder-fee3').value = sheet.forwarderFee3 || sheet.localDeliveryFee || '';
    const itemTbody = document.getElementById('item-tbody');
    itemTbody.innerHTML = '';
    sheet.items.forEach(item => {
        const newRow = itemTbody.insertRow();
        newRow.innerHTML = `<td><input type="text" class="item-name" value="${item.name || item.itemName}" oninput="ic_calculateAll()"></td><td><input type="text" class="item-lot" value="${item.lot}" oninput="ic_calculateAll()"></td><td><input type="text" class="item-qty" value="${item.qty || 0}" oninput="ic_calculateAll()" onblur="ic_formatInputForDisplay(this)"></td><td><input type="text" class="item-unit" value="${item.unit}" oninput="ic_calculateAll()"></td><td><input type="text" class="item-price" value="${item.price || 0}" oninput="ic_calculateAll()" onblur="ic_formatInputForDisplay(this)"></td><td><button type="button" class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); ic_calculateAll();">-</button></td>`;
    });
    ['form-exchange-rate', 'form-shipping-fee', 'form-tariff-amount', 'form-vat-amount', 'form-forwarder-fee1', 'form-forwarder-fee2', 'form-forwarder-fee3'].forEach(id => ic_formatInputForDisplay(document.getElementById(id)));
    document.querySelectorAll('.item-qty, .item-price').forEach(ic_formatInputForDisplay);
    ic_calculateAll();
    document.getElementById('ic-form-title').textContent = '수입 정산 수정';
    document.getElementById('ic-submit-btn').textContent = '수정 저장';
    document.getElementById('ic-submit-btn').onclick = () => ic_processCostSheet(true);
    document.getElementById('ic-cancel-btn').style.display = 'inline-block';
    window.scrollTo(0, 0);
}
function ic_toggleAllListCheckboxes(checked) { document.querySelectorAll('.sheet-checkbox').forEach(cb => cb.checked = checked); }
function ic_printForm() { window.print(); }
function ic_exportListToCsv() {
    const csvData = [];
    ic_costSheets.forEach(sheet => sheet.items.forEach(item => csvData.push({ "ETA": sheet.eta, "Shipper": sheet.shipper, "품목": item.name || item.itemName, "LOT": item.lot, "수량 (단위)": `${item.qty || 0} ${item.unit}`, "단가($)": item.price || 0, "Terms": sheet.terms, "C/O": sheet.origin, "Method": sheet.method, "CBM": sheet.cbm, "포장": sheet.packing || '', "관세(%)": sheet.tariffRate || 0, "환율": sheet.exchangeRate, "수입원가(원)": Math.round(item.unitCost || 0) })));
    downloadCSV(Papa.unparse(csvData), `수입정산내역_${new Date().toISOString().slice(0,10)}`);
}
function ic_openBulkUploadModal() {
    const modal = document.getElementById('ic_bulkUploadModal'); 
    if (modal) { modal.style.display = 'flex'; document.getElementById('ic_bulk-upload-form').reset(); document.getElementById('ic_bulk-upload-process-btn').disabled = true; document.getElementById('ic_bulk-upload-status').innerHTML = ''; }
}
function ic_closeBulkUploadModal() { document.getElementById('ic_bulkUploadModal').style.display = 'none'; }
function ic_downloadBulkTemplate() {
    const headers = ["그룹ID*", "Shipper*", "ETD*(YYYY-MM-DD)", "ETA(YYYY-MM-DD)", "적용환율*", "Terms", "Origin", "Method", "CBM", "포장", "은행 송금수수료(원)", "관세율(%)", "관세(원)", "부가가치세(원)", "현지 내륙 총 비용(원)", "수입 총 비용(원)", "국내 내륙 운송비(원)", "품목*", "LOT*", "수량*", "단위", "단가($)*"];
    downloadCSV(headers.join(',') + '\r\n', '수입정산서_일괄등록_템플릿');
}

// [수정] '수입원가 정산' CSV 처리 함수 복원 (기능 구현)
function ic_processBulkUpload() {
    const fileInput = document.getElementById('ic_bulk-csv-file');
    const file = fileInput.files[0];
    if (!file) return alert('파일을 선택해주세요.');

    const statusEl = document.getElementById('ic_bulk-upload-status');
    statusEl.innerHTML = 'CSV 파일을 파싱 중입니다...';

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
            const rows = results.data;
            if (!rows || rows.length === 0) {
                statusEl.innerHTML = '<span style="color: red;">오류: CSV 파일에 데이터가 없습니다.</span>';
                return;
            }

            // 1. 그룹ID (groupId)별로 데이터 그룹화
            const groupedData = new Map();
            for (const row of rows) {
                const groupId = row['그룹ID*']?.trim();
                if (!groupId) {
                    console.warn('경고: 그룹ID가 없는 행을 건너뜁니다.', row);
                    continue;
                }
                if (!groupedData.has(groupId)) {
                    groupedData.set(groupId, []);
                }
                groupedData.get(groupId).push(row);
            }

            statusEl.innerHTML = `총 ${rows.length}개 행에서 ${groupedData.size}개의 정산서 그룹을 찾았습니다. Firestore에 등록을 시작합니다...`;

            let successCount = 0;
            let failCount = 0;
            const batch = db.batch(); // Firestore 배치 작업

            // 2. 각 그룹을 순회하며 하나의 정산서(sheetData)로 만들기
            for (const [groupId, groupRows] of groupedData.entries()) {
                try {
                    const firstRow = groupRows[0];
                    
                    // 3. 기본 정보 파싱 (그룹의 첫 번째 행 기준)
                    const sheetData = {
                        shipper: firstRow['Shipper*']?.trim() || '',
                        etd: firstRow['ETD*(YYYY-MM-DD)']?.trim() || '',
                        eta: firstRow['ETA(YYYY-MM-DD)']?.trim() || '',
                        exchangeRate: firstRow['적용환율*']?.trim() || '0',
                        terms: firstRow['Terms']?.trim() || '',
                        origin: firstRow['Origin']?.trim() || '',
                        method: firstRow['Method']?.trim() || '',
                        cbm: firstRow['CBM']?.trim() || '',
                        packing: firstRow['포장']?.trim() || '',
                        shippingFee: firstRow['은행 송금수수료(원)']?.trim() || '0',
                        tariffRate: firstRow['관세율(%)']?.trim() || '0',
                        tariffAmount: firstRow['관세(원)']?.trim() || '0',
                        vatAmount: firstRow['부가가치세(원)']?.trim() || '0',
                        forwarderFee1: firstRow['현지 내륙 총 비용(원)']?.trim() || '0',
                        forwarderFee2: firstRow['수입 총 비용(원)']?.trim() || '0',
                        forwarderFee3: firstRow['국내 내륙 운송비(원)']?.trim() || '0',
                        items: []
                    };

                    // 4. 유효성 검사 (기본 정보)
                    if (!sheetData.shipper || !sheetData.etd || ic_pFloat(sheetData.exchangeRate) === 0) {
                        console.error(`그룹 [${groupId}] 처리 실패: 필수 항목(Shipper, ETD, 적용환율) 누락.`, firstRow);
                        failCount++;
                        continue;
                    }

                    let totalInvoiceValue = 0;

                    // 5. 품목 정보 파싱 (그룹의 모든 행)
                    for (const itemRow of groupRows) {
                        const item = {
                            name: itemRow['품목*']?.trim() || '',
                            lot: itemRow['LOT*']?.trim() || '',
                            qty: ic_pFloat(itemRow['수량*']),
                            unit: itemRow['단위']?.trim() || 'kg',
                            price: ic_pFloat(itemRow['단가($)*'])
                        };

                        // 품목 유효성 검사
                        if (!item.name || !item.lot || item.qty <= 0 || item.price < 0) {
                            console.warn(`그룹 [${groupId}] 내 유효하지 않은 품목 행을 건너뜁니다.`, itemRow);
                            continue; // 이 품목만 건너뜀
                        }
                        
                        sheetData.items.push(item);
                        totalInvoiceValue += item.qty * item.price;
                    }

                    // 6. 품목이 하나도 없으면 이 정산서 건너뜀
                    if (sheetData.items.length === 0) {
                        console.error(`그룹 [${groupId}] 처리 실패: 유효한 품목이 하나도 없습니다.`);
                        failCount++;
                        continue;
                    }

                    // 7. 최종 수입원가(unitCost) 계산
                    const exchangeRate = ic_pFloat(sheetData.exchangeRate);
                    const invoiceKrw = totalInvoiceValue * exchangeRate;
                    const totalMaterialCost = invoiceKrw + ic_pFloat(sheetData.shippingFee);
                    const tariffCost = ic_pFloat(sheetData.tariffAmount);
                    const totalForwarderFee = ic_pFloat(sheetData.forwarderFee1) + ic_pFloat(sheetData.forwarderFee2) + ic_pFloat(sheetData.forwarderFee3);
                    const grandTotal = totalMaterialCost + tariffCost + totalForwarderFee;

                    sheetData.items.forEach(item => {
                        item.unitCost = (totalInvoiceValue > 0 && item.qty > 0) ? (grandTotal * ((item.qty * item.price) / totalInvoiceValue)) / item.qty : 0;
                    });

                    // 8. 배치(Batch)에 추가
                    const docRef = importCostSheetsCollection.doc();
                    batch.set(docRef, sheetData);
                    successCount++;

                } catch (error) {
                    console.error(`그룹 [${groupId}] 처리 중 예외 발생:`, error, groupRows);
                    failCount++;
                }
            } // end of for loop (groups)

            // 9. 최종 배치 커밋
            try {
                await batch.commit();
                statusEl.innerHTML = `<span style="color: green;">일괄 등록 완료: 총 ${successCount}개 정산서 등록 성공, ${failCount}개 그룹 실패.</span>`;
                alert(`일괄 등록 완료: 성공 ${successCount}건, 실패 ${failCount}건`);
                ic_closeBulkUploadModal();
            } catch (commitError) {
                console.error("Firestore 배치 커밋 오류:", commitError);
                statusEl.innerHTML = `<span style="color: red;">오류: Firestore 저장 중 오류 발생. ${commitError.message}</span>`;
                alert(`Firestore 저장 중 오류가 발생했습니다. (성공 ${successCount}, 실패 ${failCount})`);
            }

        }, // end of complete
        error: (error) => {
            console.error('CSV 파싱 오류:', error);
            statusEl.innerHTML = `<span style="color: red;">오류: CSV 파일을 읽는 중 오류가 발생했습니다: ${error.message}</span>`;
            alert(`CSV 파일을 읽는 중 오류가 발생했습니다: ${error.message}`);
        }
    }); // end of Papa.parse
}

// ================== 5. HTML onclick과 함수 연결 ==================
window.addTransaction = () => processTransaction(false);
window.editSelectedTransaction = editSelectedTransaction;
window.deleteSelectedTransactions = deleteSelectedTransactions;
window.cancelTransactionEdit = cancelTransactionEdit;
window.showTab = showTab;
// window.toggleOtherCostsField = toggleOtherCostsField; // [삭제] 1)
window.calculateTransactionTotals = calculateTransactionTotals; // [추가] 1)
window.openBulkUploadModal = openBulkUploadModal;
window.resetTransactionFilters = resetTransactionFilters;
window.exportTransactionCSV = exportTransactionCSV;
window.toggleAllCheckboxes = toggleAllCheckboxes;
window.processBulkUpload = processBulkUpload;
window.closeBulkUploadModal = closeBulkUploadModal;
window.downloadBulkTransactionTemplate = downloadBulkTransactionTemplate;
window.resetInventoryFilters = resetInventoryFilters;
window.exportInventoryCSV = exportInventoryCSV;
window.showItemHistoryInTransactionTab = showItemHistoryInTransactionTab;
window.addSale = () => processSale(false);
window.calculateSales = calculateSales;
window.editSelectedSale = editSelectedSale;
window.deleteSelectedSales = deleteSelectedSales;
window.cancelSaleEdit = cancelSaleEdit;
window.resetSalesFilters = resetSalesFilters;
window.exportSalesCSV = exportSalesCSV;
window.addRemittance = () => processRemittance(false);
window.calculateRemittance = calculateRemittance;
window.editSelectedRemittance = editSelectedRemittance;
window.deleteSelectedRemittances = deleteSelectedRemittances;
window.cancelRemittanceEdit = cancelRemittanceEdit;
window.resetRemittanceFilters = resetRemittanceFilters;
window.exportRemittanceCSV = exportRemittanceCSV;
// START: CSV 관련 함수 window 연결 추가
window.downloadSalesCsvTemplate = downloadSalesCsvTemplate;
window.handleSalesCsvUpload = handleSalesCsvUpload;
window.processSalesCsvUpload = processSalesCsvUpload;
window.cancelSalesCsvUpload = cancelSalesCsvUpload;
window.downloadRemittanceCsvTemplate = downloadRemittanceCsvTemplate;
window.handleRemittanceCsvUpload = handleRemittanceCsvUpload;
window.processRemittanceCsvUpload = processRemittanceCsvUpload;
window.cancelRemittanceCsvUpload = cancelRemittanceCsvUpload;
// END: CSV 관련 함수 window 연결 추가
window.generateInvoice = generateInvoice;
window.printInvoice = printInvoice;
// START: 거래명세표/청구서 관련 함수 window 연결 추가
window.saveInvoiceAsPDF = saveInvoiceAsPDF;
window.addInvoiceItemRow = addInvoiceItemRow; // 거래명세표 행 추가
window.updateInvoiceTotals = updateInvoiceTotals; // 거래명세표 합계 업데이트 (내부 호출용이지만 연결)
window.generateBill = generateBill;
window.addBillItemRow = addBillItemRow; // 청구서 행 추가
window.printBill = printBill;
window.saveBillAsPDF = saveBillAsPDF;
window.calculateRowAndTotal = calculateRowAndTotal; // 청구서 행 계산
window.calculateBillTotals = calculateBillTotals; // 청구서 전체 합계
window.handleBillTableInput = handleBillTableInput; // 청구서 테이블 입력 핸들러
window.handleInvoiceTableInput = handleInvoiceTableInput; // 거래명세서 테이블 입력 핸들러
// END: 거래명세표/청구서 관련 함수 window 연결 추가

// [삭제] 2) 매출 보고서 관련
// window.generateSalesReport = generateSalesReport;
// window.resetSalesReportFilters = resetSalesReportFilters;
// window.exportSalesReportCSV = exportSalesReportCSV;

// [추가] START: 매입(국내) 탭 함수 연결
window.calculatePurchase = calculatePurchase;
window.addPurchase = () => processPurchase(false);
window.processPurchase = processPurchase;
window.editSelectedPurchase = editSelectedPurchase;
window.deleteSelectedPurchases = deleteSelectedPurchases;
window.cancelPurchaseEdit = cancelPurchaseEdit;
window.resetPurchaseFilters = resetPurchaseFilters;
window.exportPurchaseCSV = exportPurchaseCSV;
window.downloadPurchaseCsvTemplate = downloadPurchaseCsvTemplate;
window.handlePurchaseCsvUpload = handlePurchaseCsvUpload;
window.processPurchaseCsvUpload = processPurchaseCsvUpload;
window.cancelPurchaseCsvUpload = cancelPurchaseCsvUpload;
// [추가] END

window.ic_addItemRow = ic_addItemRow;
window.ic_calculateAll = ic_calculateAll;
window.ic_formatInputForDisplay = ic_formatInputForDisplay;
window.ic_printForm = ic_printForm;
window.ic_openBulkUploadModal = ic_openBulkUploadModal;
window.ic_addCostSheet = () => ic_processCostSheet(false);
window.ic_clearForm = ic_clearForm;
window.ic_renderList = ic_renderList;
window.ic_resetFilters = ic_resetFilters;
window.ic_exportListToCsv = ic_exportListToCsv;
window.ic_editSelectedSheet = ic_editSelectedSheet;
window.ic_toggleAllListCheckboxes = ic_toggleAllListCheckboxes;
window.ic_closeBulkUploadModal = ic_closeBulkUploadModal;
window.ic_downloadBulkTemplate = ic_downloadBulkTemplate;
window.ic_processBulkUpload = ic_processBulkUpload;
window.backupDataToJson = backupDataToJson;
window.restoreDataFromJson = restoreDataFromJson;
window.loadBackupFile = loadBackupFile;
window.ic_deleteSelectedSheets = ic_deleteSelectedSheets;
// [추가] START: 현황판(구. 중요메모장) 탭 함수 연결
window.renderSalesTotal = renderSalesTotal;
window.renderPurchaseTotal = renderPurchaseTotal;
window.renderExpenditureMemo = renderExpenditureMemo;
window.addExpenditureNote = addExpenditureNote;
window.deleteExpenditureNote = deleteExpenditureNote;
// [추가] END




