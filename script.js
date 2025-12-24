// ======================================================
// ⚠️ CONFIGURAÇÃO DA API
// ======================================================
const API_URL = "https://script.google.com/macros/s/AKfycbxJWmub-C26SiGwR2tGahBz3K5OX4GTp0UrC24-7-g69HN2tSDUjKgyCmK4JrO9mQH-/exec"; 

const IMGBB_API_KEY = "fa0265b3bfc740c1eb09a7e4d6ec493a"; 

// ======================================================
// 1. VARIÁVEIS GLOBAIS
// ======================================================
let dbProdutos = [];      
let carrinho = [];        
let usuario = null;       
let scannerObj = null;    
let scannerMode = 'venda'; 
let clienteAtual = { id: "", nome: "Consumidor Final" };
let formaPagamentoSel = "Dinheiro";
let formaPagamentoBaixa = "Dinheiro"; 
let configLoja = {}; 
 
let estoquePage = 1;
let tipoAjusteAtual = 'ENTRADA';
let produtoEmEdicaoId = null; 
let clienteEmBaixaId = null; 

// --- NOVAS VARIÁVEIS PARA DESCONTO ---
let tipoDesconto = 'money'; // 'money' ou 'percent'
let totalComDesconto = 0; // Armazena o total final calculado

const CACHE_PRODS_KEY = 'pdv_mobile_prods';
const USER_KEY = 'pdv_mobile_user';
const CACHE_CONFIG_KEY = 'pdv_mobile_config';
const PENDING_SALES_KEY = 'pdv_vendas_pendentes';

// Variáveis para instalação PWA
let deferredPrompt;

// ======================================================
// 🔗 BRIDGE API (COMUNICAÇÃO)
// ======================================================
async function apiRequest(action, data = {}) {
    if (!API_URL || API_URL.includes("COLE_SUA_URL")) {
        msgErro("URL da API não configurada no script.js!");
        throw new Error("API URL missing");
    }

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
            },
            body: JSON.stringify({ action: action, data: data })
        });

        const json = await response.json();

        if (json.status === 'error') {
            throw new Error(json.message);
        }
        return json.data;

    } catch (error) {
        console.error("API Error:", error);
        throw error;
    }
}

// ======================================================
// 2. INICIALIZAÇÃO & LOGIN
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    // Registrar Service Worker para PWA
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('Service Worker Registrado'))
        .catch(err => console.error('Erro SW:', err));
    }

    // Escutar evento de instalação
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const btnLogin = document.getElementById('btnInstallLogin');
        const btnSidebar = document.getElementById('btnInstallSidebar');
        if(btnLogin) btnLogin.style.display = 'block';
        if(btnSidebar) btnSidebar.style.display = 'flex';
    });

    // Listeners de Conexão
    window.addEventListener('online', atualizarStatusConexao);
    window.addEventListener('offline', atualizarStatusConexao);
    atualizarStatusConexao();

    // 1. Tenta aplicar config do cache
    const cachedConfig = localStorage.getItem(CACHE_CONFIG_KEY);
    if (cachedConfig) {
        try {
            const c = JSON.parse(cachedConfig);
            configLoja = c;
            aplicarConfiguracoesUI(c);
        } catch(e) { console.error("Erro cache config", e); }
    }
    
    // 2. Verifica sessão
    verificarSessao();

    // 3. Busca config atualizada
    carregarConfiguracoesEmpresa();
});

// --- LÓGICA OFFLINE ---

function atualizarStatusConexao() {
    const offlineBar = document.getElementById('offlineBar');
    const indicator = document.getElementById('offlineIndicator');
    const pendentes = getVendasPendentes();

    if (!navigator.onLine) {
        if(offlineBar) offlineBar.style.display = 'block';
    } else {
        if(offlineBar) offlineBar.style.display = 'none';
    }

    if (pendentes.length > 0 && navigator.onLine) {
        if(indicator) {
            indicator.style.display = 'flex';
            document.getElementById('qtdPendentes').innerText = pendentes.length;
        }
    } else {
        if(indicator) indicator.style.display = 'none';
    }
}

function getVendasPendentes() {
    const saved = localStorage.getItem(PENDING_SALES_KEY);
    return saved ? JSON.parse(saved) : [];
}

function salvarVendaOffline(dados) {
    const pendentes = getVendasPendentes();
    dados.timestamp = new Date().toISOString();
    dados.offline = true;
    pendentes.push(dados);
    localStorage.setItem(PENDING_SALES_KEY, JSON.stringify(pendentes));
    atualizarStatusConexao();
}

async function sincronizarVendas() {
    const pendentes = getVendasPendentes();
    if (pendentes.length === 0) return;

    const btnSync = document.querySelector('#offlineIndicator button');
    const txtOriginal = btnSync.innerHTML;
    btnSync.innerHTML = '<div class="spinner" style="width:14px; height:14px; border-width:2px; margin:0;"></div> Enviando...';
    btnSync.disabled = true;

    let sucessos = 0;
    let erros = 0;

    for (const venda of pendentes) {
        try {
            await apiRequest('processarVendaMobile', venda);
            sucessos++;
        } catch (e) {
            console.error("Erro ao sincronizar venda:", e);
            erros++;
        }
    }

    if (erros === 0) {
        localStorage.removeItem(PENDING_SALES_KEY);
        Swal.fire({ icon: 'success', title: 'Sincronizado!', text: `${sucessos} vendas enviadas.` });
    } else {
        Swal.fire({ icon: 'warning', title: 'Atenção', text: `${sucessos} enviadas, ${erros} falharam. Tente novamente.` });
    }

    atualizarStatusConexao();
    btnSync.innerHTML = txtOriginal;
    btnSync.disabled = false;
    carregarHistoricoVendas('HOJE');
}

function instalarApp() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                const btnLogin = document.getElementById('btnInstallLogin');
                const btnSidebar = document.getElementById('btnInstallSidebar');
                if(btnLogin) btnLogin.style.display = 'none';
                if(btnSidebar) btnSidebar.style.display = 'none';
            }
            deferredPrompt = null;
        });
    }
}

function carregarConfiguracoesEmpresa() {
    if (!navigator.onLine) return;
    apiRequest('getConfigMobile')
    .then(conf => {
        const config = (typeof conf === 'string') ? JSON.parse(conf) : conf;
        configLoja = config;
        
        const cached = localStorage.getItem(CACHE_CONFIG_KEY);
        if (cached !== JSON.stringify(config)) {
            localStorage.setItem(CACHE_CONFIG_KEY, JSON.stringify(config));
            aplicarConfiguracoesUI(config);
        }
    })
    .catch(e => console.log("Erro ao carregar config:", e));
}

function aplicarConfiguracoesUI(config) {
    if(config.nome) {
        const elName = document.getElementById('loginAppName');
        if(elName) elName.innerText = config.nome;
        const elHeader = document.getElementById('appHeaderName');
        if(elHeader) elHeader.innerHTML = `PDV <span class="highlight">${config.nome}</span>`;
    }
    if(config.logo && config.logo.startsWith('http')) {
        const img = document.getElementById('loginLogoImg');
        const icon = document.getElementById('loginLogoIcon');
        if(img && icon) {
            img.src = config.logo;
            img.style.display = 'block';
            icon.style.display = 'none';
        }
    }
    if(document.getElementById('cfgNome')) {
        document.getElementById('cfgNome').value = config.nome || "";
        document.getElementById('cfgLogo').value = config.logo || "";
        document.getElementById('cfgCnpj').value = config.cnpj || "";
        document.getElementById('cfgEnd').value = config.end || "";
        document.getElementById('cfgTel').value = config.tel || "";
        document.getElementById('cfgPix').value = config.pixKey || "";
        document.getElementById('cfgMsg').value = config.msg || "";
    }
}

function verificarSessao() {
    const savedUser = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
    if (savedUser) {
        try {
            usuario = JSON.parse(savedUser);
            iniciarApp();
        } catch(e) { 
            console.error("Erro sessão", e);
            localStorage.removeItem(USER_KEY); 
        }
    } else {
        document.getElementById('loginScreen').style.display = 'flex';
        document.getElementById('appScreen').style.display = 'none';
    }
}

function fazerLogin(event) {
    if(event) event.preventDefault(); 
    if (!navigator.onLine) { msgErro("Sem conexão para login."); return; }
    
    const user = document.getElementById('loginUser').value;
    const pass = document.getElementById('loginPass').value;
    const manterConectado = document.getElementById('chkKeepLogin').checked;
    
    const btn = document.querySelector('#loginScreen .btn-primary-mobile');
    
    if (!user || !pass) { msgErro("Preencha todos os campos"); return; }

    const txtOriginal = btn.innerText;
    btn.innerText = "A entrar...";
    btn.disabled = true;

    apiRequest('loginMobile', { login: user, senha: pass })
    .then(r => {
          usuario = (typeof r === 'string') ? JSON.parse(r) : r;
          if (manterConectado) localStorage.setItem(USER_KEY, JSON.stringify(usuario));
          else sessionStorage.setItem(USER_KEY, JSON.stringify(usuario));
          btn.innerText = txtOriginal; btn.disabled = false; iniciarApp();
    })
    .catch(e => {
          btn.innerText = txtOriginal; btn.disabled = false; msgErro(e.message);
    });
}

function logout() {
    Swal.fire({
        title: 'Sair?', text: "Terás de fazer login novamente.", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#334155', confirmButtonText: 'Sim, sair', cancelButtonText: 'Cancelar'
    }).then((result) => {
        if (result.isConfirmed) {
            localStorage.removeItem(USER_KEY);
            sessionStorage.removeItem(USER_KEY);
            location.reload();
        }
    });
}

function iniciarApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appScreen').style.display = 'block';
    document.getElementById('userNameSidebar').innerText = usuario.nome.split(' ')[0];
    carregarProdutos();
    carregarCategorias(); 
    atualizarStatusConexao();
}

// --- NAVEGAÇÃO & MENUS ---
function toggleMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar.classList.contains('active')) {
        sidebar.classList.remove('active'); overlay.classList.remove('active');
    } else {
        sidebar.classList.add('active'); overlay.classList.add('active');
    }
}

function mudarAba(aba) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    const target = document.getElementById('tab-' + aba);
    if(target) target.classList.add('active');
    
    document.querySelectorAll('.menu-item').forEach(btn => {
        btn.classList.remove('active');
        if(btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${aba}'`)) {
            btn.classList.add('active');
        }
    });
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.remove('active');
        if(btn.getAttribute('onclick') && btn.getAttribute('onclick').includes(`'${aba}'`)) {
            btn.classList.add('active');
        }
    });
    
    if (aba === 'estoque') renderizarListaEstoque(dbProdutos);
    if (aba === 'historico') carregarHistoricoVendas('HOJE');
    if (aba === 'clientes') carregarListaDevedores();
    if (aba === 'financeiro') atualizarFinanceiro();
    if (aba === 'config') aplicarConfiguracoesUI(configLoja);
    if (aba === 'usuarios') carregarUsuarios();
}

// ======================================================
// 3. PRODUTOS & CARRINHO
// ======================================================
function carregarProdutos() {
    const cache = localStorage.getItem(CACHE_PRODS_KEY);
    
    // Se offline, usa o cache e não tenta a API
    if (!navigator.onLine) {
        if (cache) {
            dbProdutos = JSON.parse(cache);
            renderizarProdutos(dbProdutos);
            renderizarListaEstoque(dbProdutos);
            console.log("Produtos carregados do cache (Offline)");
        } else {
            document.getElementById('listaProdutos').innerHTML = '<div class="empty-state"><p>Sem produtos no cache.</p></div>';
        }
        return;
    }

    if (cache) { dbProdutos = JSON.parse(cache); renderizarProdutos(dbProdutos); renderizarListaEstoque(dbProdutos); }
    
    apiRequest('getProdutosMobile')
    .then(r => {
          const lista = (typeof r === 'string') ? JSON.parse(r) : r;
          dbProdutos = lista;
          localStorage.setItem(CACHE_PRODS_KEY, JSON.stringify(dbProdutos));
          renderizarProdutos(dbProdutos);
          renderizarListaEstoque(dbProdutos); 
    })
    .catch(console.error);
}

function carregarCategorias() {
    if (!navigator.onLine) return; 
    apiRequest('getCategoriasMobile')
    .then(r => {
        const cats = (typeof r === 'string') ? JSON.parse(r) : r;
        const selCad = document.getElementById('cadCategoria');
        const selEdit = document.getElementById('editCategoria');
        const divChips = document.getElementById('catChips');
        if(selCad) selCad.innerHTML = '<option value="Geral">Geral</option>';
        if(selEdit) selEdit.innerHTML = '<option value="Geral">Geral</option>';
        if(divChips) {
            divChips.innerHTML = `<button class="cat-chip active" onclick="filtrarPorCategoria('Todas', this)">Todas</button>`;
            cats.forEach(c => { divChips.innerHTML += `<button class="cat-chip" onclick="filtrarPorCategoria('${c.nome}', this)">${c.nome}</button>`; });
        }
        cats.forEach(c => {
            if(selCad) selCad.innerHTML += `<option value="${c.nome}">${c.nome}</option>`;
            if(selEdit) selEdit.innerHTML += `<option value="${c.nome}">${c.nome}</option>`;
        });
    })
    .catch(console.error);
}

const fmtMoney = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function renderizarProdutos(lista) {
    const container = document.getElementById('listaProdutos');
    container.innerHTML = '';
    if (lista.length === 0) { container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; opacity:0.6">Nenhum produto encontrado.</div>'; return; }
    
    lista.sort((a, b) => {
        const aPromo = (a.precoPromo > 0);
        const bPromo = (b.precoPromo > 0);
        if (aPromo && !bPromo) return -1;
        if (!aPromo && bPromo) return 1;
        return a.nome.localeCompare(b.nome);
    });

    lista.forEach(p => {
        const img = p.foto && p.foto.includes('http') ? p.foto : 'https://i.postimg.cc/Hx8k8k8k/box.png';
        const semStock = p.controla && p.estoque <= 0;
        const classDisabled = semStock ? 'disabled' : '';
        let badgesHtml = '<div class="card-badges">';
        if (semStock) badgesHtml += '<div class="stock-tag">Esgotado</div>';
        else if (p.controla && p.estoque < 5) badgesHtml += `<div class="stock-tag low">Restam ${p.estoque}</div>`;
        let priceHtml = `<div class="p-price">${fmtMoney(p.preco)}</div>`;
        if (p.precoPromo > 0 && !semStock) {
            badgesHtml += '<div class="promo-tag">OFERTA</div>';
            priceHtml = `<div class="p-price" style="font-size:0.8rem; color:var(--text-muted); text-decoration:line-through; margin-bottom:-2px;">${fmtMoney(p.preco)}</div><div class="p-price" style="color:var(--danger)">${fmtMoney(p.precoPromo)}</div>`;
        }
        badgesHtml += '</div>';
        container.innerHTML += `<div class="prod-card-mobile ${classDisabled}" onclick="addCarrinho('${p.id}')">${badgesHtml}<div class="img-box"><img src="${img}" loading="lazy"></div><div class="info-box"><div class="p-name">${p.nome}</div>${priceHtml}</div></div>`;
    });
}

function filtrarProdutos(termo) {
    const t = termo.toLowerCase();
    const filtrados = dbProdutos.filter(p => p.nome.toLowerCase().includes(t) || p.cod.toLowerCase().includes(t));
    renderizarProdutos(filtrados);
}
 
function filtrarPorCategoria(cat, btn) {
    document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    if(cat === 'Todas') { renderizarProdutos(dbProdutos); } else { const filtrados = dbProdutos.filter(p => p.cat === cat); renderizarProdutos(filtrados); }
}

function addCarrinho(id) {
    const p = dbProdutos.find(x => x.id === id);
    if (!p) return;
    if (p.controla && p.estoque <= 0) { msgErro("Produto esgotado!"); navigator.vibrate(200); return; }
    const itemExistente = carrinho.find(x => x.id === id);
    const precoFinal = (p.precoPromo && p.precoPromo > 0) ? p.precoPromo : p.preco;
    if (itemExistente) {
        if (p.controla && (itemExistente.qtd + 1 > p.estoque)) { msgErro("Stock insuficiente!"); return; }
        itemExistente.qtd++;
    } else { carrinho.push({ id: p.id, nome: p.nome, preco: precoFinal, qtd: 1, foto: p.foto }); }
    atualizarCarrinhoUI();
    msgSucessoToast(`${p.nome} adicionado!`);
    navigator.vibrate(50);
}

function removerItem(index) { carrinho.splice(index, 1); atualizarCarrinhoUI(); }
function limparCarrinho() { if(carrinho.length===0) return; carrinho=[]; atualizarCarrinhoUI(); }

function atualizarCarrinhoUI() {
    const lista = document.getElementById('cartItemsList');
    const count = document.getElementById('cartCount');
    const badgeNav = document.getElementById('badgeCarrinhoTopo');
    const totalEl = document.getElementById('totalCarrinho');
    lista.innerHTML = '';
    let total = 0; let qtdItens = 0;
    if (carrinho.length === 0) {
        lista.innerHTML = `<div class="empty-state"><i class="material-icons-round">remove_shopping_cart</i><p>Carrinho vazio</p></div>`;
        if(badgeNav) badgeNav.style.display = 'none';
    } else {
        carrinho.forEach((item, index) => {
            const subtotal = item.preco * item.qtd;
            total += subtotal; qtdItens += item.qtd;
            const img = item.foto && item.foto.includes('http') ? item.foto : 'https://i.postimg.cc/Hx8k8k8k/box.png';
            lista.innerHTML += `<div class="cart-item-mobile"><img src="${img}" class="ci-img"><div class="ci-info"><div class="ci-name">${item.nome}</div><div class="ci-price">${item.qtd} x ${fmtMoney(item.preco)}</div><div class="ci-sub">${fmtMoney(subtotal)}</div></div><button class="ci-remove" onclick="removerItem(${index})"><i class="material-icons-round">delete</i></button></div>`;
        });
        if(badgeNav) { badgeNav.innerText = qtdItens; badgeNav.style.display = 'flex'; }
    }
    count.innerText = qtdItens;
    totalEl.innerText = fmtMoney(total);
    document.getElementById('totalPagamentoDisplay').innerText = fmtMoney(total);
}

function irParaPagamento() {
    if (carrinho.length === 0) { msgErro("Carrinho vazio!"); return; }
    
    // Resetar Desconto
    tipoDesconto = 'money';
    document.getElementById('valDesconto').value = '';
    document.querySelectorAll('.desc-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('btnDescMoney').classList.add('active');
    
    calcularTotaisComDesconto();
    
    selecionarPagamento('Dinheiro', document.getElementById('payBtnDinheiro'));
    document.getElementById('modalPagamento').classList.add('active'); 
    document.getElementById('modalPagamento').style.display = 'flex';
}

function alternarTipoDesconto(tipo) {
    tipoDesconto = tipo;
    document.querySelectorAll('.desc-btn').forEach(b => b.classList.remove('active'));
    if(tipo === 'money') document.getElementById('btnDescMoney').classList.add('active');
    else document.getElementById('btnDescPercent').classList.add('active');
    calcularTotaisComDesconto();
}

function calcularTotaisComDesconto() {
    const subtotal = carrinho.reduce((a, b) => a + (b.preco * b.qtd), 0);
    let descontoInput = parseFloat(document.getElementById('valDesconto').value);
    if (isNaN(descontoInput) || descontoInput < 0) descontoInput = 0;

    let descontoFinal = 0;
    if (tipoDesconto === 'money') {
        descontoFinal = descontoInput;
    } else {
        descontoFinal = subtotal * (descontoInput / 100);
    }

    if (descontoFinal > subtotal) descontoFinal = subtotal;

    totalComDesconto = subtotal - descontoFinal;

    document.getElementById('subtotalDisplay').innerText = `Subtotal: ${fmtMoney(subtotal)}`;
    document.getElementById('totalPagamentoDisplay').innerText = fmtMoney(totalComDesconto);
    
    if(formaPagamentoSel === 'Dinheiro') calcularTrocoMobile();
    if(formaPagamentoSel === 'Pix') gerarQRPixMobile();
}

function selecionarPagamento(tipo, el) {
    formaPagamentoSel = tipo;
    document.querySelectorAll('#modalPagamento .pag-btn').forEach(b => b.classList.remove('selected'));
    if(el) el.classList.add('selected');
    document.querySelectorAll('.payment-area').forEach(area => area.style.display = 'none');
    if (tipo === 'Dinheiro') { document.getElementById('areaDinheiro').style.display = 'block'; document.getElementById('valRecebidoMobile').value = ''; document.getElementById('trocoDisplayMobile').innerText = 'Troco: R$ 0,00'; setTimeout(() => document.getElementById('valRecebidoMobile').focus(), 300); }
    else if (tipo === 'Pix') { document.getElementById('areaPix').style.display = 'block'; gerarQRPixMobile(); }
    else if (tipo === 'Fiado') { document.getElementById('areaFiado').style.display = 'block'; atualizarNomeClienteFiado(); }
}

function calcularTrocoMobile() {
    let valStr = document.getElementById('valRecebidoMobile').value; 
    valStr = valStr.replace(',', '.');
    const recebido = parseFloat(valStr);
    const total = totalComDesconto;
    
    const elTroco = document.getElementById('trocoDisplayMobile');
    if (!recebido || isNaN(recebido)) { elTroco.innerText = 'Troco: R$ 0,00'; elTroco.style.color = 'var(--text-muted)'; return; }
    const troco = recebido - total;
    if (troco < 0) { elTroco.innerText = `Falta: ${fmtMoney(Math.abs(troco))}`; elTroco.style.color = 'var(--danger)'; } 
    else { elTroco.innerText = `Troco: ${fmtMoney(troco)}`; elTroco.style.color = 'var(--secondary)'; }
}

function gerarQRPixMobile() {
    const total = totalComDesconto;
    const chave = configLoja.pixKey;
    if (!chave) { msgErro("Chave Pix não configurada na Planilha!"); return; }
    const payload = gerarPayloadPix(chave, total, configLoja.nome || "PDV", "BRASIL", "MBL001");
    new QRious({ element: document.getElementById('qrPixMobile'), value: payload, size: 200, backgroundAlpha: 0, foreground: 'black' });
}

function atualizarNomeClienteFiado() {
    document.getElementById('nomeClienteFiadoMobile').innerText = clienteAtual.nome;
    if (!clienteAtual.id) document.getElementById('avisoFiadoMobile').style.display = 'block';
    else document.getElementById('avisoFiadoMobile').style.display = 'none';
}

function confirmarVendaMobile() {
    if (formaPagamentoSel === 'Fiado' && !clienteAtual.id) { msgErro("Selecione um cliente para Fiado!"); return; }
    
    const totalBruto = carrinho.reduce((a, b) => a + (b.preco * b.qtd), 0);
    const totalFinal = totalComDesconto;
    
    // Captura valores extras se for dinheiro
    let recebido = 0;
    let troco = 0;
    if(formaPagamentoSel === 'Dinheiro') {
        const valStr = document.getElementById('valRecebidoMobile').value.replace(',', '.');
        recebido = parseFloat(valStr) || 0;
        if(recebido < totalFinal) { msgErro("Valor recebido insuficiente!"); return; }
        troco = recebido - totalFinal;
    }

    const dadosVenda = { 
        itens: carrinho.map(i => ({ id: i.id, nome: i.nome, qtd: i.qtd, preco: i.preco, subtotal: i.preco * i.qtd })), 
        cliente: clienteAtual.id, 
        vendedor: usuario.nome, 
        totalBruto: Number(totalBruto.toFixed(2)), 
        totalFinal: Number(totalFinal.toFixed(2)), 
        pagamento: formaPagamentoSel,
        // Extras para o detalhamento
        recebido: Number(recebido.toFixed(2)),
        troco: Number(troco.toFixed(2)),
        desconto: Number((totalBruto - totalFinal).toFixed(2))
    };
    
    const btn = document.querySelector('.confirm-btn');
    
    if (!navigator.onLine) {
        salvarVendaOffline(dadosVenda);
        Swal.fire({ title: 'Salvo Offline!', text: 'Será enviado quando conectar.', icon: 'info', timer: 2000, showConfirmButton: false });
        carrinho = []; atualizarCarrinhoUI(); fecharModal('modalPagamento'); 
        selecionarCliente("", "Consumidor Final");
        mudarAba('vender');
        return;
    }

    Swal.fire({ title: 'Processando Venda...', text: 'Aguarde um momento', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });
    btn.disabled = true;
    
    apiRequest('processarVendaMobile', dadosVenda)
    .then(r => {
          Swal.fire({ title: 'Sucesso!', text: 'Venda realizada.', icon: 'success', timer: 2000, showConfirmButton: false });
          carrinho = []; atualizarCarrinhoUI(); fecharModal('modalPagamento'); 
          selecionarCliente("", "Consumidor Final");
          mudarAba('vender');
          btn.disabled = false; carregarProdutos();
    })
    .catch(e => {
          if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
              salvarVendaOffline(dadosVenda);
              Swal.fire({ title: 'Salvo Offline!', text: 'Erro de rede. Salvo para envio posterior.', icon: 'info', timer: 2000, showConfirmButton: false });
              carrinho = []; atualizarCarrinhoUI(); fecharModal('modalPagamento'); 
              selecionarCliente("", "Consumidor Final");
              mudarAba('vender');
          } else {
              btn.disabled = false; msgErro(e.message);
          }
    });
}

// ======================================================
// 5. MÓDULOS GESTÃO (ATUALIZADO)
// ======================================================

function carregarHistoricoVendas(filtro) {
    if (!navigator.onLine) {
        document.getElementById('listaHistoricoVendas').innerHTML = '<div class="empty-state"><p>Histórico indisponível offline.</p></div>';
        return;
    }
    const lista = document.getElementById('listaHistoricoVendas');
    lista.innerHTML = '<div class="loading-placeholder"><div class="spinner"></div></div>';
    document.querySelectorAll('#tab-historico .chip').forEach(c => c.classList.remove('active'));
    if(event && event.target) event.target.classList.add('active');
    
    apiRequest('getHistoricoVendasMobile', { filtro: filtro })
    .then(r => {
        const vendas = (typeof r === 'string') ? JSON.parse(r) : r;
        lista.innerHTML = '';
        if (vendas.length === 0) { lista.innerHTML = '<div class="empty-state"><i class="material-icons-round">history_toggle_off</i><p>Sem vendas neste período</p></div>'; return; }
        vendas.forEach(v => {
            // Prepara o objeto para passar para o modal (codificado para evitar problemas com aspas)
            const objVenda = encodeURIComponent(JSON.stringify(v));
            const valorExibir = v.total ? fmtMoney(Number(v.total)) : "R$ 0,00";

            lista.innerHTML += `<div class="list-item" onclick="verDetalhesVenda('${objVenda}')"><div class="icon-box"><i class="material-icons-round">receipt_long</i></div><div class="info"><strong>${v.cliente}</strong><span>${v.data} • ${v.pagamento}</span></div><div style="font-weight:bold; color:var(--primary);">${valorExibir}</div></div>`;
        });
    })
    .catch(console.error);
}

function verDetalhesVenda(vendaEncoded) {
    const venda = JSON.parse(decodeURIComponent(vendaEncoded));
    const modal = document.getElementById('modalDetalheVenda');
    const content = document.getElementById('detalheVendaConteudo');
    
    const extras = venda.extras || {};
    const desconto = extras.desconto || 0;
    const recebido = extras.recebido || 0;
    const troco = extras.troco || 0;
    const vendedor = extras.vendedor || venda.vendedor || "Mobile";

    // Bloco de Pagamento Dinâmico
    let htmlPagamento = '';
    if(venda.pagamento === 'Dinheiro') {
        htmlPagamento = `
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.9rem;">
                <span style="color:var(--text-muted)">Recebido:</span><span>${fmtMoney(recebido)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.9rem;">
                <span style="color:var(--text-muted)">Troco:</span><span style="color:var(--secondary); font-weight:bold;">${fmtMoney(troco)}</span>
            </div>`;
    }

    content.innerHTML = `
        <div style="text-align:center; padding-bottom:10px; margin-bottom:10px; border-bottom:1px dashed var(--border);">
            <h3 style="margin:0; color:var(--text-main); letter-spacing:1px; text-transform:uppercase;">${configLoja.nome || 'PDV Mobile'}</h3>
            <p style="margin:5px 0; font-size:0.8rem; color:var(--text-muted);">Comprovante de Venda</p>
        </div>
        
        <div style="border-bottom:1px dashed var(--border); padding-bottom:10px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.9rem;">
                <span style="color:var(--text-muted)">Data:</span><span>${venda.data}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.9rem;">
                <span style="color:var(--text-muted)">Cliente:</span><span style="font-weight:600;">${venda.cliente}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.9rem;">
                <span style="color:var(--text-muted)">Vendedor:</span><span>${vendedor}</span>
            </div>
        </div>

        <p style="margin:0 0 10px 0; font-size:0.8rem; color:var(--text-muted); text-transform:uppercase;">Itens Consumidos</p>
        <div id="listaItensRecibo" style="border-bottom:1px dashed var(--border); padding-bottom:10px; margin-bottom:10px;">
            <div class="loading-placeholder" style="padding:10px;"><div class="spinner" style="width:20px; height:20px; border-width:2px;"></div></div>
        </div>

        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.9rem;">
            <span style="color:var(--text-muted)">Subtotal:</span><span>${fmtMoney(venda.totalBruto || venda.total)}</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.9rem;">
            <span style="color:var(--text-muted)">Desconto:</span><span style="color:var(--danger)">-${fmtMoney(desconto)}</span>
        </div>
        
        <div style="display:flex; justify-content:space-between; align-items:center; margin: 10px 0; font-size:1.2rem;">
            <span>TOTAL</span><span style="font-weight:800; color:var(--primary);">${fmtMoney(venda.total)}</span>
        </div>

        <div style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:0.9rem;">
                <span style="color:var(--text-muted)">Forma Pagamento:</span><span style="font-weight:600;">${venda.pagamento}</span>
            </div>
            ${htmlPagamento}
        </div>

        <div style="margin-top:20px; text-align:center;">
            <p style="font-size:0.7rem; color:var(--text-muted);">Obrigado pela preferência!</p>
        </div>
    `;
    modal.style.display = 'flex';
    
    apiRequest('getItensVendaMobile', { idVenda: venda.id })
    .then(r => {
        const itens = (typeof r === 'string') ? JSON.parse(r) : r;
        const divItens = document.getElementById('listaItensRecibo');
        divItens.innerHTML = '';
        if(itens.length === 0) { divItens.innerHTML = '<p style="font-size:0.8rem; font-style:italic; text-align:center;">Detalhes indisponíveis para vendas antigas.</p>'; return; }
        itens.forEach(i => { divItens.innerHTML += `<div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:0.9rem;"><div style="flex:1;"><div>${i.nome}</div><div style="font-size:0.8rem; color:var(--text-muted);">${i.qtd} x ${fmtMoney(i.preco)}</div></div><div style="font-weight:600;">${fmtMoney(i.subtotal)}</div></div>`; });
    })
    .catch(console.error);
}

// ... (RESTO DO CÓDIGO PERMANECE IDÊNTICO) ...
function carregarUsuarios() { if (!navigator.onLine) return; const lista = document.getElementById('listaUsuarios'); lista.innerHTML = '<div class="loading-placeholder"><div class="spinner"></div></div>'; apiRequest('getUsuariosMobile').then(r => { const users = (typeof r === 'string') ? JSON.parse(r) : r; lista.innerHTML = ''; if(users.length === 0) { lista.innerHTML = '<p style="text-align:center; opacity:0.5;">Nenhum usuário.</p>'; return; } users.forEach(u => { lista.innerHTML += `<div class="list-item" onclick="abrirModalUsuario('${u.id}', '${u.nome}', '${u.login}', '${u.perfil}')"><div class="icon-box"><i class="material-icons-round">person</i></div><div class="info"><strong>${u.nome}</strong><span>${u.perfil} | ${u.login}</span></div><button class="btn-text-danger" onclick="excluirUsuario('${u.id}'); event.stopPropagation();"><i class="material-icons-round">delete</i></button></div>`; }); }).catch(console.error); }
function abrirModalUsuario(id='', nome='', login='', perfil='Vendedor') { document.getElementById('usuId').value = id; document.getElementById('usuNome').value = nome; document.getElementById('usuLogin').value = login; document.getElementById('usuSenha').value = ''; document.getElementById('usuPerfil').value = perfil; document.getElementById('modalUsuario').style.display = 'flex'; }
function salvarUsuario(e) { e.preventDefault(); const dados = { id: document.getElementById('usuId').value, nome: document.getElementById('usuNome').value, login: document.getElementById('usuLogin').value, senha: document.getElementById('usuSenha').value, perfil: document.getElementById('usuPerfil').value }; if(!dados.id && !dados.senha) { msgErro("Senha é obrigatória para novo usuário."); return; } const btn = e.target.querySelector('button'); const txt = btn.innerText; btn.innerText = "Salvando..."; btn.disabled = true; apiRequest('salvarUsuarioMobile', dados).then(r => { Swal.fire({icon:'success', title: r, timer: 1500, showConfirmButton:false}); fecharModal('modalUsuario'); carregarUsuarios(); btn.innerText = txt; btn.disabled = false; }).catch(e => { msgErro(e.message); btn.innerText = txt; btn.disabled = false; }); }
function excluirUsuario(id) { Swal.fire({ title: 'Excluir usuário?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#334155', confirmButtonText: 'Sim' }).then((result) => { if (result.isConfirmed) { apiRequest('excluirUsuarioMobile', { id: id }).then(r => { Swal.fire('Excluído!', r, 'success'); carregarUsuarios(); }).catch(e => msgErro(e.message)); } }); }
function carregarListaDevedores() { if (!navigator.onLine) { document.getElementById('listaDevedores').innerHTML = '<div class="empty-state"><p>Lista indisponível offline.</p></div>'; return; } const lista = document.getElementById('listaDevedores'); lista.innerHTML = '<div class="loading-placeholder"><div class="spinner"></div></div>'; apiRequest('getClientesComDividaMobile').then(r => { const clientes = (typeof r === 'string') ? JSON.parse(r) : r; lista.innerHTML = ''; if (clientes.length === 0) { lista.innerHTML = '<div class="empty-state"><p>Nenhum cliente cadastrado.</p></div>'; return; } clientes.forEach(c => { const temDivida = c.saldo > 0; const corSaldo = temDivida ? 'var(--danger)' : 'var(--secondary)'; const btnBaixa = temDivida ? `<button class="btn-sm-primary" style="margin-top:5px; width:100%;" onclick="abrirBaixaFiado('${c.id}', '${c.nome}', ${c.saldo}); event.stopPropagation();">Baixar Dívida</button>` : ''; lista.innerHTML += `<div class="prod-card-mobile" style="flex-direction:column; align-items:flex-start; gap:5px;"><div style="display:flex; justify-content:space-between; width:100%; align-items:center;"><div style="font-weight:bold; font-size:1rem;">${c.nome}</div><div style="font-weight:bold; color:${corSaldo};">${fmtMoney(c.saldo)}</div></div><div style="font-size:0.8rem; color:var(--text-muted);">CPF: ${c.cpf}</div>${btnBaixa}</div>`; }); }).catch(console.error); }
function filtrarListaClientes(termo) { const t = termo.toLowerCase(); const cards = document.querySelectorAll('#listaDevedores .prod-card-mobile'); cards.forEach(card => { const nome = card.innerText.toLowerCase(); if(nome.includes(t)) card.style.display = 'flex'; else card.style.display = 'none'; }); }
function abrirBaixaFiado(id, nome, saldo) { clienteEmBaixaId = id; document.getElementById('baixaIdCliente').value = id; document.getElementById('baixaNomeCliente').innerText = nome; document.getElementById('baixaDividaAtual').innerText = fmtMoney(saldo); document.getElementById('baixaValor').value = ''; const listaExtrato = document.getElementById('extratoClienteLista'); listaExtrato.innerHTML = 'Carregando...'; apiRequest('getExtratoClienteMobile', { id: id }).then(r => { const hist = (typeof r === 'string') ? JSON.parse(r) : r; listaExtrato.innerHTML = ''; hist.forEach(h => { const cor = h.tipo === 'VENDA' ? 'var(--danger)' : 'var(--secondary)'; listaExtrato.innerHTML += `<div style="display:flex; justify-content:space-between; margin-bottom:5px; border-bottom:1px solid rgba(255,255,255,0.05);"><span>${h.data} (${h.tipo})</span><span style="color:${cor}">${fmtMoney(h.valor)}</span></div>`; }); }).catch(console.error); document.getElementById('modalBaixaFiado').classList.add('active'); document.getElementById('modalBaixaFiado').style.display = 'flex'; }
function selPagBaixa(tipo, btn) { formaPagamentoBaixa = tipo; document.querySelectorAll('#modalBaixaFiado .pag-btn').forEach(b => b.classList.remove('selected')); btn.classList.add('selected'); }
function confirmarBaixaFiado() { const valor = document.getElementById('baixaValor').value; if(!valor || valor <= 0) { msgErro("Valor inválido"); return; } const btn = document.querySelector('#modalBaixaFiado .btn-primary-mobile'); Swal.fire({ title: 'Processando...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } }); btn.disabled = true; const dados = { clienteId: clienteEmBaixaId, valor: valor, formaPagamento: formaPagamentoBaixa, usuario: usuario.nome }; apiRequest('baixarFiadoMobile', dados).then(r => { Swal.fire({ icon: 'success', title: 'Pagamento Recebido!', text: r }); fecharModal('modalBaixaFiado'); carregarListaDevedores(); btn.disabled = false; }).catch(e => { btn.disabled = false; msgErro(e.message); }); }
function atualizarFinanceiro() { if (!navigator.onLine) { document.getElementById('dashVendasHoje').innerText = '-'; document.getElementById('dashFiados').innerText = '-'; document.getElementById('dashStatusCaixa').innerText = 'Offline'; return; } document.getElementById('dashVendasHoje').innerText = '...'; document.getElementById('dashFiados').innerText = '...'; apiRequest('getResumoFinanceiroMobile').then(r => { const dados = (typeof r === 'string') ? JSON.parse(r) : r; document.getElementById('dashVendasHoje').innerText = fmtMoney(dados.vendasHoje); document.getElementById('dashFiados').innerText = fmtMoney(dados.fiadosReceber); const st = document.getElementById('dashStatusCaixa'); st.innerText = dados.statusCaixa; st.style.color = dados.statusCaixa === 'ABERTO' ? 'var(--secondary)' : 'var(--danger)'; }).catch(console.error); }
function salvarConfiguracoes(e) { e.preventDefault(); const btn = e.target.querySelector('button[type="submit"]'); const txt = btn.innerText; btn.innerText = "Salvando..."; btn.disabled = true; const form = { nome: document.getElementById('cfgNome').value, logo: document.getElementById('cfgLogo').value, pixKey: document.getElementById('cfgPix').value, cnpj: document.getElementById('cfgCnpj').value, end: document.getElementById('cfgEnd').value, tel: document.getElementById('cfgTel').value, msg: document.getElementById('cfgMsg').value }; apiRequest('salvarConfigMobile', form).then(r => { Swal.fire('Sucesso', r, 'success'); btn.innerText = txt; btn.disabled = false; carregarConfiguracoesEmpresa(); }).catch(e => { msgErro(e.message); btn.innerText = txt; btn.disabled = false; }); }
function abrirScanner(modo) { scannerMode = modo; document.getElementById('tituloScanner').innerText = modo === 'venda' ? 'Ler para Vender' : 'Ler para Cadastrar'; document.getElementById('modalScanner').style.display = 'flex'; setTimeout(() => { if (!scannerObj) { const formats = [ Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8, Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39, Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E, Html5QrcodeSupportedFormats.ITF ]; scannerObj = new Html5Qrcode("reader", { verbose: false, formatsToSupport: formats }); } const config = { fps: 15, qrbox: { width: 300, height: 120 }, aspectRatio: 1.0 }; scannerObj.start({ facingMode: "environment" }, config, onScanSuccess, onScanFailure).catch(err => { msgErro("Erro ao iniciar câmera: " + err); fecharScanner(); }); }, 300); }
function fecharScanner() { document.getElementById('modalScanner').style.display = 'none'; if (scannerObj) { scannerObj.stop().then(() => { }).catch(err => console.log(err)); } }
function onScanSuccess(decodedText, decodedResult) { playBeep(); if (scannerMode === 'venda') { const p = dbProdutos.find(x => x.cod === decodedText); if (p) { addCarrinho(p.id); msgSucessoToast(`Lido: ${p.nome}`); } else { msgErro("Produto não encontrado!"); } } else if (scannerMode === 'cadastro') { document.getElementById('cadCodigo').value = decodedText; fecharScanner(); msgSucessoToast("Código capturado!"); } }
function onScanFailure(error) {}
function playBeep() { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.value = 1200; gain.gain.value = 0.1; osc.start(); osc.stop(ctx.currentTime + 0.1); if (navigator.vibrate) navigator.vibrate(100); }
function abrirCadastroCliente() { fecharModal('modalClientes'); document.getElementById('formCadClienteMobile').reset(); document.getElementById('modalCadastroCliente').style.display = 'flex'; }
function salvarNovoClienteMobile(e) { e.preventDefault(); const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true; const dados = { nome: document.getElementById('cliNome').value, cpf: document.getElementById('cliDoc').value, telefone: document.getElementById('cliTel').value, endereco: document.getElementById('cliEnd').value, limite: document.getElementById('cliLimite').value }; apiRequest('salvarClienteMobile', dados).then(json => { const novoCliente = (typeof json === 'string') ? JSON.parse(json) : json; selecionarCliente(novoCliente.id, novoCliente.nome); fecharModal('modalCadastroCliente'); Swal.fire({ icon: 'success', title: 'Cliente Cadastrado!', timer: 1500, showConfirmButton: false }); btn.disabled = false; if(document.getElementById('tab-clientes').classList.contains('active')) carregarListaDevedores(); }).catch(err => { msgErro(err.message); btn.disabled = false; }); }
function abrirSeletorCliente() { document.getElementById('modalClientes').style.display = 'flex'; document.getElementById('buscaClienteMobile').focus(); }
function buscarClienteAPI(termo) { if(termo.length < 2) return; apiRequest('buscarClientesMobile', { termo: termo }).then(json => { const lista = (typeof json === 'string') ? JSON.parse(json) : json; const div = document.getElementById('listaClientesBusca'); div.innerHTML = ''; div.innerHTML += `<div class="list-item" onclick="selecionarCliente('','Consumidor Final')"><div class="icon-box"><i class="material-icons-round">person</i></div><div class="info"><strong>Consumidor Final</strong><span>Padrão</span></div></div>`; lista.forEach(c => { div.innerHTML += `<div class="list-item" onclick="selecionarCliente('${c.id}','${c.nome}')"><div class="icon-box"><i class="material-icons-round">account_circle</i></div><div class="info"><strong>${c.nome}</strong><span>${c.cpf}</span></div></div>`; }); }); }
function selecionarCliente(id, nome) { clienteAtual = { id: id, nome: nome }; document.getElementById('clienteAtualNome').innerText = nome.split(' ')[0]; const elFiado = document.getElementById('nomeClienteFiadoMobile'); if(elFiado) elFiado.innerText = nome.split(' ')[0]; if(id) document.getElementById('avisoFiadoMobile').style.display = 'none'; fecharModal('modalClientes'); }
function fecharModal(id) { document.getElementById(id).style.display = 'none'; if(id === 'modalPagamento' || id === 'modalBaixaFiado' || id === 'modalUsuario' || id === 'modalAjusteEstoque' || id === 'modalCatalogo') document.getElementById(id).classList.remove('active'); }
function msgErro(msg) { Swal.fire({ icon: 'error', title: 'Oops...', text: msg.replace('Error: ', ''), confirmButtonColor: '#06b6d4' }); }
function msgSucessoToast(msg) { const Toast = Swal.mixin({ toast: true, position: 'top-end', showConfirmButton: false, timer: 1500, timerProgressBar: true, background: '#1e293b', color: '#fff' }); Toast.fire({ icon: 'success', title: msg }); }
function crc16(str) { let crc = 0xFFFF; for (let i = 0; i < str.length; i++) { crc ^= str.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) { if ((crc & 0x8000) !== 0) crc = (crc << 1) ^ 0x1021; else crc = crc << 1; } } return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); }
function gerarPayloadPix(chave, valor, nome='LOJA', cidade='BRASIL', txtId='***') { const format = (id, val) => id + (val.length.toString().padStart(2, '0')) + val; const payloadKey = format('00', 'BR.GOV.BCB.PIX') + format('01', chave); const valorStr = valor.toFixed(2); let emv = format('00', '01') + format('26', payloadKey) + format('52', '0000') + format('53', '986') + format('54', valorStr) + format('58', 'BR') + format('59', nome.substring(0, 25)) + format('60', cidade.substring(0, 15)) + format('62', format('05', txtId)) + '6304'; return emv + crc16(emv); }
function renderizarListaEstoque(lista) { const container = document.getElementById('listaEstoqueProdutos'); if(!container) return; container.innerHTML = ''; if (lista.length === 0) { container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; opacity:0.6">Nenhum produto.</div>'; return; } lista.forEach(p => { if (p.controla) { const corEstoque = p.estoque <= 0 ? 'var(--danger)' : (p.estoque < 5 ? '#f59e0b' : 'var(--secondary)'); const img = p.foto && p.foto.includes('http') ? p.foto : 'https://i.postimg.cc/Hx8k8k8k/box.png'; container.innerHTML += `<div class="prod-card-mobile" style="padding: 12px; gap: 15px;" onclick="abrirAjusteEstoque('${p.id}')"><div class="img-box" style="width: 50px; height: 50px;"><img src="${img}"></div><div class="info-box"><div class="p-name">${p.nome}</div><div style="font-size:0.8rem; color:var(--text-muted)">Qtd Atual: <strong style="color:${corEstoque}; font-size:1rem;">${p.estoque}</strong></div></div><i class="material-icons-round" style="color:var(--primary); opacity:0.5">edit</i></div>`; } }); }
function filtrarEstoqueMobile(termo) { const t = termo.toLowerCase(); const filtrados = dbProdutos.filter(p => p.nome.toLowerCase().includes(t) || p.cod.toLowerCase().includes(t)); renderizarListaEstoque(filtrados); }
function abrirAjusteEstoque(id) { const p = dbProdutos.find(x => x.id === id); if (!p) return; produtoEmEdicaoId = p.id; document.getElementById('ajusteIdProd').value = p.id; document.getElementById('ajusteNomeProd').innerText = p.nome; document.getElementById('ajusteQtd').value = ''; setTipoAjuste('ENTRADA'); document.getElementById('modalAjusteEstoque').classList.add('active'); document.getElementById('modalAjusteEstoque').style.display = 'flex'; }
function setTipoAjuste(tipo) { tipoAjusteAtual = tipo; document.getElementById('btnEntrada').classList.remove('selected'); document.getElementById('btnSaida').classList.remove('selected'); document.getElementById('btnEntrada').classList.remove('entrada'); document.getElementById('btnSaida').classList.remove('saida'); if (tipo === 'ENTRADA') { document.getElementById('btnEntrada').classList.add('selected'); document.getElementById('btnEntrada').classList.add('entrada'); } else { document.getElementById('btnSaida').classList.add('selected'); document.getElementById('btnSaida').classList.add('saida'); } }
function confirmarAjusteMobile() { const id = document.getElementById('ajusteIdProd').value; const qtd = document.getElementById('ajusteQtd').value; const motivo = document.getElementById('ajusteMotivo').value; if (!qtd || qtd <= 0) { msgErro("Qtd inválida."); return; } const btn = document.querySelector('#modalAjusteEstoque .confirm-btn'); btn.disabled = true; const dados = { id: id, tipo: tipoAjusteAtual, qtd: qtd, motivo: motivo || "Ajuste Mobile", usuario: usuario.nome }; apiRequest('lancarMovimentacaoEstoqueMobile', dados).then(r => { Swal.fire({ title: 'Sucesso!', text: r, icon: 'success', timer: 1500, showConfirmButton: false }); fecharModal('modalAjusteEstoque'); btn.disabled = false; carregarProdutos(); }).catch(e => { btn.disabled = false; msgErro(e.message); }); }
function abrirEdicaoProduto() { if(!produtoEmEdicaoId) return; const p = dbProdutos.find(x => x.id === produtoEmEdicaoId); if(!p) return; document.getElementById('editNome').value = p.nome; document.getElementById('editPreco').value = p.preco; document.getElementById('editPromo').value = p.precoPromo || ''; document.getElementById('editCod').value = p.cod; const selCat = document.getElementById('editCategoria'); if(selCat) selCat.value = p.cat; fecharModal('modalAjusteEstoque'); document.getElementById('modalEditarProduto').style.display = 'flex'; }
function salvarEdicaoProduto() { const btn = document.querySelector('#modalEditarProduto button'); btn.disabled = true; const dados = { id: produtoEmEdicaoId, nome: document.getElementById('editNome').value, preco: document.getElementById('editPreco').value, promo: document.getElementById('editPromo').value, cat: document.getElementById('editCategoria').value, cod: document.getElementById('editCod').value }; apiRequest('editarProdutoMobile', dados).then(r => { Swal.fire({ icon: 'success', title: 'Atualizado!', timer: 1500, showConfirmButton: false }); fecharModal('modalEditarProduto'); btn.disabled = false; carregarProdutos(); }).catch(e => { Swal.fire('Erro', e.message, 'error'); btn.disabled = false; }); }
function excluirProdutoConfirmacao() { if(!produtoEmEdicaoId) return; Swal.fire({ title: 'Tem certeza?', text: "O produto será desativado.", icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', cancelButtonColor: '#334155', confirmButtonText: 'Sim, excluir' }).then((result) => { if (result.isConfirmed) { apiRequest('excluirProdutoMobile', { id: produtoEmEdicaoId }).then(r => { Swal.fire('Excluído!', r, 'success'); fecharModal('modalAjusteEstoque'); carregarProdutos(); }); } }); }
function salvarProdutoMobileFront(e) { e.preventDefault(); const btn = e.target.querySelector('button[type="submit"]'); btn.disabled = true; const dados = { prodNome: document.getElementById('cadNome').value, prodPreco: document.getElementById('cadPreco').value, prodPromo: document.getElementById('cadPromo').value, prodEstoque: document.getElementById('cadEstoque').value, prodCat: document.getElementById('cadCategoria').value, prodCod: document.getElementById('cadCodigo').value, prodFoto: document.getElementById('cadFoto').value, prodDesc: document.getElementById('cadDesc').value, prodControlaEstoque: document.getElementById('cadControla').checked }; apiRequest('salvarProdutoMobile', dados).then(r => { Swal.fire({ title: 'Sucesso!', text: 'Produto cadastrado!', icon: 'success', timer: 2000, showConfirmButton: false }); document.getElementById('formCadastroMobile').reset(); document.getElementById('statusUploadMobile').style.display = 'none'; btn.disabled = false; carregarProdutos(); mudarAba('vender'); }).catch(e => { btn.disabled = false; msgErro(e.message); }); }
function uploadImagemMobile(input) { if (!input.files || !input.files[0]) return; if (!IMGBB_API_KEY || IMGBB_API_KEY.includes("COLE_SUA")) { msgErro("Configure API Key ImgBB!"); return; } const file = input.files[0]; const status = document.getElementById('statusUploadMobile'); const campoUrl = document.getElementById('cadFoto'); status.style.display = 'block'; status.style.color = 'var(--text-muted)'; status.innerText = 'A enviar imagem...'; campoUrl.setAttribute('disabled', true); const formData = new FormData(); formData.append("image", file); fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: "POST", body: formData }).then(response => response.json()).then(result => { if (result.success) { campoUrl.value = result.data.url; campoUrl.removeAttribute('disabled'); status.style.color = 'var(--secondary)'; status.innerText = 'Imagem carregada!'; } else { throw new Error("Falha upload."); } }).catch(error => { status.style.color = 'var(--danger)'; status.innerText = 'Erro no envio.'; campoUrl.removeAttribute('disabled'); }); }
function abrirHistoricoGeral() { document.getElementById('modalHistoricoGeral').style.display = 'flex'; carregarHistoricoEstoque(); }
function carregarHistoricoEstoque() { if (!navigator.onLine) return; const lista = document.getElementById('listaHistoricoCompleta'); lista.innerHTML = '<div class="loading-placeholder"><div class="spinner"></div> Carregando...</div>'; estoquePage = 1; document.getElementById('btnLoadMoreStock').style.display = 'none'; apiRequest('getHistoricoEstoqueMobile', { page: estoquePage }).then(r => { const dados = (typeof r === 'string') ? JSON.parse(r) : r; renderizarHistoricoEstoque(dados, true); }); }
function carregarMaisEstoque() { estoquePage++; const btn = document.getElementById('btnLoadMoreStock'); btn.disabled = true; apiRequest('getHistoricoEstoqueMobile', { page: estoquePage }).then(r => { const dados = (typeof r === 'string') ? JSON.parse(r) : r; renderizarHistoricoEstoque(dados, false); btn.disabled = false; }); }
function renderizarHistoricoEstoque(lista, reset) { const container = document.getElementById('listaHistoricoCompleta'); if (reset) container.innerHTML = ''; if (lista.length === 0 && reset) { container.innerHTML = '<div class="empty-state"><i class="material-icons-round">history</i><p>Sem histórico</p></div>'; return; } if (lista.length < 20) { document.getElementById('btnLoadMoreStock').style.display = 'none'; } else { document.getElementById('btnLoadMoreStock').style.display = 'block'; } lista.forEach(i => { const cor = i.tipo === 'ENTRADA' ? 'var(--secondary)' : 'var(--danger)'; const icon = i.tipo === 'ENTRADA' ? 'arrow_downward' : 'arrow_upward'; container.innerHTML += `<div class="stock-item-mobile"><div class="st-icon" style="color:${cor}; border-color:${cor}"><i class="material-icons-round">${icon}</i></div><div class="st-info"><div class="st-prod">${i.nome}</div><div class="st-meta">${i.data} • ${i.usuario}</div><div class="st-obs">${i.motivo}</div></div><div class="st-qty" style="color:${cor}">${i.tipo === 'ENTRADA' ? '+' : '-'}${i.qtd}</div></div>`; }); }
function abrirModalCatalogo() { document.getElementById('modalCatalogo').style.display = 'flex'; setTimeout(() => { document.getElementById('modalCatalogo').classList.add('active'); }, 10); }
function copiarLinkCatalogo() { const copyText = document.getElementById("linkCatalogoInput"); copyText.select(); copyText.setSelectionRange(0, 99999); navigator.clipboard.writeText(copyText.value).then(() => { msgSucessoToast("Link copiado!"); }).catch(err => { console.error('Erro ao copiar: ', err); document.execCommand('copy'); msgSucessoToast("Link copiado!"); }); }
function compartilharNativo() { if (navigator.share) { navigator.share({ title: 'Catálogo Digital', text: 'Confira nosso catálogo de produtos:', url: 'https://sistemashoop.github.io/CatalagoRB/' }).then(() => console.log('Successful share')).catch((error) => console.log('Error sharing', error)); } else { copiarLinkCatalogo(); } }
