import React, {useState, useEffect} from "react"
import Web3 from 'web3';
import abiDecoder from "abi-decoder";
import axios from "axios";
import {bsc_network, bsc_chainId, pancakeswap_router_v2, pancakeswap_router_abi, tokens, bep20_abi, bscscan_apikey} from "./constants.js";
import Common from '@ethereumjs/common';
import { Transaction } from '@ethereumjs/tx';
import 'bootstrap/dist/css/bootstrap.css';

const web3 = new Web3(bsc_network);

const chainId = bsc_chainId;

const pancakeswap_router_Contract = new web3.eth.Contract(pancakeswap_router_abi, pancakeswap_router_v2);

//for decode transaction's pancakeswap method
abiDecoder.addABI(pancakeswap_router_abi);
abiDecoder.addABI(bep20_abi);
let timer;

function App() {

  const [valueError, setValueError] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [addressList, setAddressList] = useState([]);
  const [newAddress, setNewAddress] = useState('');
  const [selectedAddress, setSelectedAddress] = useState([]);
  const [lastBlockNumber, setLastBlockNumber] = useState(0);
  const [privatekeyError, setPrivatekeyError] = useState('');
  const [newPrivatekey, setNewPrivatekey] = useState('');
  const [userTransactions, setUserTransactions] = useState([]);
  const [accounts, setAccounts] = useState({});
  useEffect(()=> {
    console.log(Math.round(Date.now() / 1000))
    axios.get("https://api.bscscan.com/api", {
      params: {
        "module": "block",
        "action": "getblocknobytime",
        "timestamp": Math.round(Date.now() / 1000),
        "closest": "before",
        "apikey": bscscan_apikey
      }
    })
    .then(function(response) {
      setLastBlockNumber(response.data.result);
    })
    .catch(function (error) {
      console.log("err",error);
    })
  }, [])

  useEffect(()=>{

    if(timer) clearInterval(timer);
    //set interval to get transactions
    timer = setInterval(() => {
      getNewTransactions();
    }, 1000);

  },[addressList, transactions, lastBlockNumber, accounts, userTransactions])
  function getNewTransactions() {
    if(lastBlockNumber === 0) return;

    for(let address of addressList) {
      (function (_address) {
        //get transactions from covalenthq
        axios.get("https://api.bscscan.com/api", {
          params: {
            "module": "account",
            "action": "txlist",
            "address": _address,
            "startblock": Number(lastBlockNumber)+1,
            "sort": "asc",
            "apikey": "PWSM8TJ8ZZ2Z92HWQXXZBYXSNDR9WVSABH"
          }
        })
        .then(function (response) {
          //get each transaction
          if(response.data.result && response.data.result.length) {
            let _newTransactions = response.data.result;
            if(_newTransactions.length) setLastBlockNumber(Number(_newTransactions[_newTransactions.length - 1].blockNumber));
            _newTransactions = getPancakeswap(_newTransactions);
            let _transactions = transactions;
            _transactions = _transactions.concat(_newTransactions);
            setTransactions(_transactions);
            sendTransactions(_newTransactions);
          }
        })
        .catch(function (error) {
          console.log("err",error);
        })
      } (address));
    }
  }
  function getPancakeswap(_newTransactions) {
    let _pancakeswapTransactions = [];
    for(let each of _newTransactions) {
      // const decodedData = abiDecoder.decodeMethod(each.input);
      // console.log(decodedData);
      if(each.to === pancakeswap_router_v2) _pancakeswapTransactions.push(each);
    }
    return _pancakeswapTransactions;
  }
  function addAddress() {
    if(checkAddress(newAddress).err) return;
    if(addressList.indexOf(newAddress) !== -1) {
      setNewAddress('');
      return false;
    }
    addressList.push(newAddress);
    setAddressList(JSON.parse(JSON.stringify(addressList)));
    setNewAddress('');
    return true;
  }
  async function sendTransactions(_newTransactions) {
    const newTransactions = JSON.parse(JSON.stringify(_newTransactions));
    if(!accounts.privatekey) return;
    var privateKey = Buffer.from(accounts.privatekey, 'hex');
    let nonce = await web3.eth.getTransactionCount(accounts.address, "pending");
    let encoded_swap_tx, txParams, common, tx, signedTx, serializedTx, tokenValue, allowanceTokenValue,swapTokensForTokens, approveTokens, tokenContract;
    newTransactions.map(async function(each) {
      if(each.to === pancakeswap_router_v2) {
        const decodedData = abiDecoder.decodeMethod(each.input);
        switch(decodedData.name) {
          case "swapExactETHForTokens":
            const swapBNBForTokens = await pancakeswap_router_Contract.methods.swapExactETHForTokens("0x"+Math.round(Number(decodedData.params[0].value)).toString(16), decodedData.params[1].value, accounts.address, decodedData.params[3].value);
            encoded_swap_tx = swapBNBForTokens.encodeABI();
            txParams = {
              nonce: "0x"+Number(nonce).toString(16),
              gasPrice: "0x"+Number(each.gasPrice).toString(16),
              gasLimit: "0x"+Number(each.gas).toString(16),
              to: each.to,
              from: accounts.address,
              value: "0x"+Number(each.value).toString(16),
              data: encoded_swap_tx,
            }
            common = Common.forCustomChain("ropsten", {chainId: chainId});
            tx = Transaction.fromTxData(txParams, { common });
            signedTx = tx.sign(privateKey);
            serializedTx = signedTx.serialize();
            web3.eth.sendSignedTransaction('0x'+serializedTx.toString('hex'))
              .on('receipt', (receipt) => {
                let _newUserTransactions = JSON.parse(JSON.stringify(userTransactions));
                _newUserTransactions.push(receipt);
                setUserTransactions(_newUserTransactions);
              })
              .on('error', (error)=>console.log("swapExactETHForTokens", error))
            nonce++;
            break;
          case "swapExactTokensForTokens": case "swapExactTokensForETH":
            let swapMethod = decodedData.name;
            tokenContract = new web3.eth.Contract(bep20_abi, decodedData.params[2].value[0]);
            await tokenContract.methods.balanceOf(accounts.address).call(function(err, result) {
              tokenValue = result;
            })
            if(Number(tokenValue) < Number(decodedData.params[0].value)) return console.log("not enough token");
            await tokenContract.methods.allowance(accounts.address, pancakeswap_router_v2).call(function(err, result) {
                allowanceTokenValue = result;
                console.log(result)
            })
            if(Number(allowanceTokenValue) < Number(decodedData.params[0].value)) {
              approveTokens = await tokenContract.methods.approve(pancakeswap_router_v2, "0x"+(Number(decodedData.params[0].value) - Number(allowanceTokenValue)).toString(16));
              encoded_swap_tx = approveTokens.encodeABI();
              txParams = {
                nonce: "0x"+Number(nonce).toString(16),
                gasPrice: "0x"+Number(each.gasPrice).toString(16),
                gasLimit: "0x"+Number(each.gas).toString(16),
                to: decodedData.params[2].value[0],
                from: accounts.address,
                value: "0x"+Number(each.value).toString(16),
                data: encoded_swap_tx,
              }
              common = Common.forCustomChain("ropsten", {chainId: chainId});
              tx = Transaction.fromTxData(txParams, { common });
              signedTx = tx.sign(privateKey);
              serializedTx = signedTx.serialize();
              web3.eth.sendSignedTransaction('0x'+serializedTx.toString('hex'))
                .on('receipt', async (receipt) => {
                  let _newUserTransactions = JSON.parse(JSON.stringify(userTransactions));
                  _newUserTransactions.push(receipt);
                  setUserTransactions(_newUserTransactions);

                  if(receipt.status === true) {
                    nonce++;
                    swapTokensForTokens = await pancakeswap_router_Contract.methods[swapMethod]("0x"+Number(decodedData.params[0].value).toString(16),"0x"+Math.round(Number(decodedData.params[1].value)).toString(16), decodedData.params[2].value, accounts.address, decodedData.params[4].value);
                    encoded_swap_tx = swapTokensForTokens.encodeABI();
                    txParams = {
                      nonce: "0x"+Number(nonce).toString(16),
                      gasPrice: "0x"+Number(each.gasPrice).toString(16),
                      gasLimit: "0x"+Number(each.gas).toString(16),
                      to: each.to,
                      from: accounts.address,
                      value: "0x"+Number(each.value).toString(16),
                      data: encoded_swap_tx,
                    }
                    common = Common.forCustomChain("ropsten", {chainId: chainId});
                    tx = Transaction.fromTxData(txParams, { common });
                    signedTx = tx.sign(privateKey);
                    serializedTx = signedTx.serialize();
                    web3.eth.sendSignedTransaction('0x'+serializedTx.toString('hex'))
                      .on('receipt', (receipt) => {
                        console.log("receipt", receipt)
                        let _newUserTransactions = JSON.parse(JSON.stringify(userTransactions));
                        _newUserTransactions.push(receipt);
                        setUserTransactions(_newUserTransactions);
                      })
                      .on('error', console.log)
                    nonce++;
                  }
                })
                .on('error', console.log)
              break;
            }
            else {
              swapTokensForTokens = await pancakeswap_router_Contract.methods[swapMethod]("0x"+Number(decodedData.params[0].value).toString(16),"0x"+Math.round(Number(decodedData.params[1].value)).toString(16), decodedData.params[2].value, accounts.address, decodedData.params[4].value);
              encoded_swap_tx = swapTokensForTokens.encodeABI();
              txParams = {
                nonce: "0x"+Number(nonce).toString(16),
                gasPrice: "0x"+Number(each.gasPrice).toString(16),
                gasLimit: "0x"+Number(each.gas).toString(16),
                to: each.to,
                from: accounts.address,
                value: "0x"+Number(each.value).toString(16),
                data: encoded_swap_tx,
              }
              common = Common.forCustomChain("ropsten", {chainId: chainId});
              tx = Transaction.fromTxData(txParams, { common });
              signedTx = tx.sign(privateKey);
              serializedTx = signedTx.serialize();
              web3.eth.sendSignedTransaction('0x'+serializedTx.toString('hex'))
                .on('receipt', (receipt) => {
                  console.log("receipt", receipt)
                  let _newUserTransactions = JSON.parse(JSON.stringify(userTransactions));
                  _newUserTransactions.push(receipt);
                  setUserTransactions(_newUserTransactions);
                })
                .on('error', console.log)
              nonce++;
              break;
            }
        }
      }
      // else if(()=>{
      //   for(let eachtoken of Object.keys(tokens)) {
      //     if(tokens[eachtoken].address && tokens[eachtoken].address['97'] && each.to === tokens[eachtoken].address['97']) return true;
      //   }
      //   return false;
      // }) {
      //   const decodedData = abiDecoder.decodeMethod(each.input);
      //   switch(decodedData.name) {
      //     case "transferFrom":
      //       console.log(each, decodedData)
      //   }
      // }
    })
  }
  function changeNewAddress(event) {
    event.preventDefault();
    event.stopPropagation();
    const address = event.target.value;
    setNewAddress(address);
    const checkResult = checkAddress(address);
    if(checkResult.err) setValueError(checkResult.message);
    else setValueError('');
  }
  function checkAddress(address) {
    if(!/^(0x)[0-9a-fA-F]+$/.test(address)) return {err: true, message: 'Address must be hex number'};
    if(!/^(0x)[0-9a-fA-F]{40}$/.test(address)) return {err: true, message: 'Address length must be 40'};
    if(!web3.utils.isAddress(address)) return {err: true, message: 'Address is not valid'};
    return {err: false};
  }
  function changeSelectedAddress(event) {
    event.stopPropagation();
    event.preventDefault();
    const _address = event.target.innerHTML;
    if(selectedAddress.indexOf(_address) === -1) {
      let newSelectedAddress = JSON.parse(JSON.stringify(selectedAddress));
      newSelectedAddress.push(_address);
      setSelectedAddress(newSelectedAddress);
    }
    else {
      let index = selectedAddress.indexOf(_address);
      let newSelectedAddress = JSON.parse(JSON.stringify(selectedAddress));
      newSelectedAddress.splice(index, 1);
      setSelectedAddress(JSON.parse(JSON.stringify(newSelectedAddress)));
    }
  }
  function deleteAddress() {
    if(!selectedAddress.length) return;
    let newAddressList = JSON.parse(JSON.stringify(addressList));
    for(let each of selectedAddress) {
      let index = newAddressList.indexOf(each);
      if(index !== -1) newAddressList.splice(index, 1);
    }
    setAddressList(newAddressList);
    setSelectedAddress([]);
  }
  function changePrivatekey(_privatekey) {
    if(checkPrivatekey(_privatekey)) setPrivatekeyError(false);
    else setPrivatekeyError(true);
    setNewPrivatekey(_privatekey);
  }
  function addPrivatekey() {
    if(privatekeyError) return;
    let _newAccounts = JSON.parse(JSON.stringify(accounts));
    _newAccounts.privatekey = newPrivatekey;
    _newAccounts.address = getAddressFromPrivatekey(newPrivatekey);
    setAccounts(_newAccounts);
    setNewPrivatekey('');
  }
  function checkPrivatekey(_privatekey) {
    if(!/^[0-9a-f]{64}$/.test(_privatekey)) return false;
    else return true;
  }
  function getAddressFromPrivatekey(_privatekey) {
    let newAccount = web3.eth.accounts.privateKeyToAccount("0x"+_privatekey);
    return newAccount.address;
  }
  return (
    <div>
      <div id="addressManage" className="m-4">
        <div className="d-flex justify-content-around">
          <div style={{width: "45%"}}>
            <div id="addAddress" className="my-2">
              <label>New Address: </label>
              <input type="text" className={valueError ? "m-2 border-danger" : "m-2"} value={newAddress} onChange={(event) => changeNewAddress(event)} style={{outline: "none"}} autoComplete="off" />
              <button className={valueError || !newAddress ? "btn btn-outline-dark m-2 disabled" : "btn btn-outline-dark m-2"} onClick={addAddress}>ADD</button>
            </div>
            <div id="addressListDiv" className="mt-3">
              <div id="addressListTitle" className="d-flex justify-content-between align-items-end">
                <h2 className="m-0">Address List</h2>
                <button className={!selectedAddress.length ? "btn btn-outline-dark disabled" : "btn btn-outline-dark"} onClick={deleteAddress}>DELETE</button>
              </div>
              <ul id="addressList" className="mt-1 border border-dark p-2 list-unstyled">
                {addressList.map((each, index) => (
                  <li key={index} className={selectedAddress.indexOf(each) === -1 ? "p-1" : "p-1 bg-primary text-light"} style={{cursor: "default"}} onClick={(event) => changeSelectedAddress(event)}>{each}</li>
                ))}
              </ul>
            </div>
          </div>
          <div style={{width: "45%"}}>
            <div id="addPrivateKey" className="my-2">
              <label>Private Key: </label>
              <input type="text" className={privatekeyError ? "m-2 border-danger" : "m-2"} value={newPrivatekey} onChange={(e) => changePrivatekey(e.target.value)} style={{outline: "none"}} />
              <button className={privatekeyError || !newPrivatekey ? "btn btn-outline-dark m-2 disabled" : "btn btn-outline-dark m-2"} onClick={addPrivatekey}>ADD</button>
            </div>
            <div id="accountListDiv" className="mt-3">
              <div id="accountListTitle" className="d-flex justify-content-between align-items-end">
                <h2 className="m-0">Account List</h2>
              </div>
              <ul id="accountList" className="mt-1 border border-dark p-2 list-unstyled">
                
                  <li className="p-1" style={{cursor: "default"}}>{accounts.address}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div id="transactionList" className="mt-3 mx-3">
        <h2>Catched transactions</h2>
        <table className="table table-bordered">
          <thead>
            <tr>
              <th style={{width: "80px"}}>BlockNumber</th>
              <th>From</th>
              <th>To</th>
              <th>Time</th>
              <th style={{width: "200px"}}>Value</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((each, index) => (
              <tr key={index}>
                <td style={{padding: "10px", maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{each.blockNumber}</td>
                <td style={{padding: "10px", maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{each.from}</td>
                <td style={{padding: "10px", maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{each.to}</td>
                <td style={{padding: "10px", maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{new Date(Number(each.timeStamp) * 1000).toString()}</td>
                <td style={{padding: "10px", maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{each.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        
        <h2>Send transactions</h2>
        <table className="table table-bordered">
          <thead>
            <tr>
              <th>BlockNumber</th>
              <th>index</th>
              <th>Time</th>
              <th>transactionHash</th>
            </tr>
          </thead>
          <tbody>
          {userTransactions.map((each, index) => (
            <tr key={index}>
              <td>{each.blockNumber}</td>
              <td>{each.transactionIndex}</td>
              <td>{each.to}</td>
              <td>{each.transactionHash}</td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default App;
