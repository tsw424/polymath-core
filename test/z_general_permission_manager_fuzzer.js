import latestTime from './helpers/latestTime';
import {signData} from './helpers/signData';
import { pk }  from './helpers/testprivateKey';
import { duration, promisifyLogWatch, latestBlock } from './helpers/utils';
import { takeSnapshot, increaseTime, revertToSnapshot } from './helpers/time';
import { catchRevert } from "./helpers/exceptions";
import { setUpPolymathNetwork, deployGPMAndVerifyed, deployCountTMAndVerifyed } from "./helpers/createInstances";
import { encodeModuleCall } from "./helpers/encodeCall";

const SecurityToken = artifacts.require('./SecurityToken.sol');
const GeneralTransferManager = artifacts.require('./GeneralTransferManager');
const GeneralPermissionManager = artifacts.require('./GeneralPermissionManager');
const CountTransferManager = artifacts.require("./CountTransferManager");

const Web3 = require('web3');
const BigNumber = require('bignumber.js');
const web3 = new Web3(new Web3.providers.HttpProvider("http://localhost:8545")) // Hardcoded development port

contract('GeneralPermissionManager', accounts => {

    // Accounts Variable declaration
    let account_polymath;
    let account_issuer;
    let token_owner;
    let token_owner_pk;
    let account_investor1;
    let account_investor2;
    let account_investor3;
    let account_investor4;
    let account_delegate;
    let account_delegate2;
    let account_delegate3;
    // investor Details
    let fromTime = latestTime();
    let toTime = latestTime();
    let expiryTime = toTime + duration.days(15);

    let message = "Transaction Should Fail!";

    // Contract Instance Declaration
    let I_GeneralPermissionManagerFactory;
    let P_GeneralPermissionManagerFactory;
    let I_SecurityTokenRegistryProxy;
    let P_GeneralPermissionManager;
    let I_GeneralTransferManagerFactory;
    let I_GeneralPermissionManager;
    let I_GeneralTransferManager;
    let I_ModuleRegistryProxy;
    let I_ModuleRegistry;
    let I_FeatureRegistry;
    let I_SecurityTokenRegistry;
    let I_DummySTOFactory;
    let I_STFactory;
    let I_SecurityToken;
    let I_MRProxied;
    let I_STRProxied;
    let I_PolyToken;
    let I_PolymathRegistry;
    let I_CountTransferManagerFactory;
    let I_CountTransferManager;

    // SecurityToken Details
    const name = "Team";
    const symbol = "sap";
    const tokenDetails = "This is equity type of issuance";
    const decimals = 18;
    const contact = "team@polymath.network";
    const delegateDetails = "Hello I am legit delegate";

    // Module key
    const delegateManagerKey = 1;
    const transferManagerKey = 2;
    const stoKey = 3;

    // Initial fee for ticker registry and security token registry
    const initRegFee = web3.utils.toWei("250");

    // CountTransferManager details
	const holderCount = 2; // Maximum number of token holders
	let bytesSTO = encodeModuleCall(["uint256"], [holderCount]);

	let _details = "details holding for test";

	// permission manager fuzz test
	let perms = ['ADMIN', 'DISTRIBUTE', 'MANAGE', 'MADEUP1', 'MADEUP2'];
	let totalPerms = perms.length;

    before(async () => {
        // Accounts setup
        account_polymath = accounts[0];
        account_issuer = accounts[1];

        token_owner = account_issuer;
        token_owner_pk = pk.account_1;

        account_investor1 = accounts[8];
        account_investor2 = accounts[9];
        account_delegate = accounts[7];
        account_delegate2 = accounts[6];
        account_delegate3 = accounts[5];

        // Step 1: Deploy the genral PM ecosystem
        let instances = await setUpPolymathNetwork(account_polymath, token_owner);

        [
            I_PolymathRegistry,
            I_PolyToken,
            I_FeatureRegistry,
            I_ModuleRegistry,
            I_ModuleRegistryProxy,
            I_MRProxied,
            I_GeneralTransferManagerFactory,
            I_STFactory,
            I_SecurityTokenRegistry,
            I_SecurityTokenRegistryProxy,
            I_STRProxied
        ] = instances;

        // STEP 5: Deploy the GeneralDelegateManagerFactory
        [I_GeneralPermissionManagerFactory] = await deployGPMAndVerifyed(account_polymath, I_MRProxied, I_PolyToken.address, 0);
        // STEP 6: Deploy the GeneralDelegateManagerFactory
        [P_GeneralPermissionManagerFactory] = await deployGPMAndVerifyed(account_polymath, I_MRProxied, I_PolyToken.address, web3.utils.toWei("500"));

	    // Deploy CountTransferManager
        [I_CountTransferManagerFactory] = await deployCountTMAndVerifyed(account_polymath, I_MRProxied, I_PolyToken.address, 0);

        // Printing all the contract addresses
        console.log(`
        --------------------- Polymath Network Smart Contracts: ---------------------
        PolymathRegistry:                  ${I_PolymathRegistry.address}
        SecurityTokenRegistryProxy:        ${I_SecurityTokenRegistryProxy.address}
        SecurityTokenRegistry:             ${I_SecurityTokenRegistry.address}
        ModuleRegistryProxy                ${I_ModuleRegistryProxy.address}
        ModuleRegistry:                    ${I_ModuleRegistry.address}
        FeatureRegistry:                   ${I_FeatureRegistry.address}

        STFactory:                         ${I_STFactory.address}
        GeneralTransferManagerFactory:     ${I_GeneralTransferManagerFactory.address}
        GeneralPermissionManagerFactory:   ${I_GeneralPermissionManagerFactory.address}
        -----------------------------------------------------------------------------
        `);
    });

    describe("Generate the SecurityToken", async () => {
        it("Should register the ticker before the generation of the security token", async () => {
            await I_PolyToken.approve(I_STRProxied.address, initRegFee, { from: token_owner });
            let tx = await I_STRProxied.registerTicker(token_owner, symbol, contact, { from: token_owner });
            assert.equal(tx.logs[0].args._owner, token_owner);
            assert.equal(tx.logs[0].args._ticker, symbol.toUpperCase());
        });

        it("Should generate the new security token with the same symbol as registered above", async () => {
            await I_PolyToken.approve(I_STRProxied.address, initRegFee, { from: token_owner });
            let _blockNo = latestBlock();
            let tx = await I_STRProxied.generateSecurityToken(name, symbol, tokenDetails, false, { from: token_owner });

            // Verify the successful generation of the security token
            assert.equal(tx.logs[1].args._ticker, symbol.toUpperCase(), "SecurityToken doesn't get deployed");

            I_SecurityToken = SecurityToken.at(tx.logs[1].args._securityTokenAddress);

            const log = await promisifyLogWatch(I_SecurityToken.ModuleAdded({ from: _blockNo }), 1);

            // Verify that GeneralTransferManager module get added successfully or not
            assert.equal(log.args._types[0].toNumber(), 2);
            assert.equal(web3.utils.toAscii(log.args._name).replace(/\u0000/g, ""), "GeneralTransferManager");
        });

        it("Should intialize the auto attached modules", async () => {
            let moduleData = (await I_SecurityToken.getModulesByType(2))[0];
            I_GeneralTransferManager = GeneralTransferManager.at(moduleData);
        });

        it("Should successfully attach the General permission manager factory with the security token -- failed because Token is not paid", async () => {
            let errorThrown = false;
            await I_PolyToken.getTokens(web3.utils.toWei("500", "ether"), token_owner);
            await catchRevert(
                I_SecurityToken.addModule(P_GeneralPermissionManagerFactory.address, "0x", web3.utils.toWei("500", "ether"), 0, { from: token_owner })
            );
        });

        it("Should successfully attach the General permission manager factory with the security token", async () => {
            let snapId = await takeSnapshot();
            await I_PolyToken.transfer(I_SecurityToken.address, web3.utils.toWei("500", "ether"), { from: token_owner });
            const tx = await I_SecurityToken.addModule(
                P_GeneralPermissionManagerFactory.address,
                "0x",
                web3.utils.toWei("500", "ether"),
                0,
                { from: token_owner }
            );
            assert.equal(tx.logs[3].args._types[0].toNumber(), delegateManagerKey, "General Permission Manager doesn't get deployed");
            assert.equal(
                web3.utils.toAscii(tx.logs[3].args._name).replace(/\u0000/g, ""),
                "GeneralPermissionManager",
                "GeneralPermissionManagerFactory module was not added"
            );
            P_GeneralPermissionManager = GeneralPermissionManager.at(tx.logs[3].args._module);
            await revertToSnapshot(snapId);
        });

        it("Should successfully attach the General permission manager factory with the security token", async () => {
            const tx = await I_SecurityToken.addModule(I_GeneralPermissionManagerFactory.address, "0x", 0, 0, { from: token_owner });
            assert.equal(tx.logs[2].args._types[0].toNumber(), delegateManagerKey, "General Permission Manager doesn't get deployed");
            assert.equal(
                web3.utils.toAscii(tx.logs[2].args._name).replace(/\u0000/g, ""),
                "GeneralPermissionManager",
                "GeneralPermissionManagerFactory module was not added"
            );
            I_GeneralPermissionManager = GeneralPermissionManager.at(tx.logs[2].args._module);
        });
    });

	describe("permission fuzz test for count transfer manager", async () => {

		it("Should successfully attach the CountTransferManager with the security token", async () => {
            const tx = await I_SecurityToken.addModule(I_CountTransferManagerFactory.address, bytesSTO, 0, 0, { from: token_owner });
            assert.equal(tx.logs[2].args._types[0].toNumber(), transferManagerKey, "CountTransferManager doesn't get deployed");
            assert.equal(
                web3.utils.toAscii(tx.logs[2].args._name).replace(/\u0000/g, ""),
                "CountTransferManager",
                "CountTransferManager module was not added"
            );
            I_CountTransferManager = CountTransferManager.at(tx.logs[2].args._module);
        });

        it("fuzz test changeHolderCount", async () => {

	        for (var i = 2; i < 50; i++) {
	        	var j = Math.floor(Math.random() * 10);
	        	if (j === 1 || j === 0) { j = 2 };
	        	if (await I_GeneralPermissionManager.checkDelegate(accounts[j]) !== true) {
	        		await I_GeneralPermissionManager.addDelegate(accounts[j], _details, { from: token_owner });
	        	} 

	        	let randomPerms = perms[Math.floor(Math.random() * Math.floor(totalPerms))];
	        	await I_GeneralPermissionManager.changePermission(accounts[j], I_CountTransferManager.address, randomPerms, true, { from: token_owner });	
         		let userPerm = await I_GeneralPermissionManager.checkPermission(accounts[j], I_CountTransferManager.address, 'ADMIN');
      
         		if (userPerm === true) {
         			await I_CountTransferManager.changeHolderCount(i + 1, { from: accounts[j] });
         			assert.equal((await I_CountTransferManager.maxHolderCount()).toNumber(), i + 1);
         			console.log("Test number " + i + " with account " + j + " and perm " + randomPerms + " passed");
         		} else {
         			await catchRevert(I_CountTransferManager.changeHolderCount(i+1, { from: accounts[j] }));
         			console.log("Test number " + i + " with account " + j + " and perm " + randomPerms + " failed as expected");
         		}
	        }
        });
	});   
});